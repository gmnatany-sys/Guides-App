'use server'

import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { revalidatePath } from 'next/cache'
import { deliverReservationEmails } from '@/lib/email-log'
import { syncDates, refreshBookingPages } from '@/lib/booking-workflows'
import { getCurrentUser } from '@/lib/auth'

export async function fetchActiveTours() {
  await requirePermission("booking_form_access")

  const t0 = Date.now()
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('tours')
    .select('*')
    .eq('active', true)
    .order('name')

  console.log(`[v0] pageData route=/booking step=fetchActiveTours duration=${Date.now() - t0}ms`)
  return {
    tours: data || [],
    error: error?.message || null
  }
}

// Active agents for the booking form's Agent dropdown.
export async function fetchActiveAgents() {
  const actor = await requirePermission("booking_form_access")

  if (actor.role === 'agent') return {agents:[{id:actor.id,full_name:actor.full_name,email:actor.email}],error:null}
  const t0 = Date.now()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('app_users')
    .select('id, full_name, email')
    .eq('role', 'agent')
    .eq('active', true)
    .order('full_name', { ascending: true })

  console.log(`[v0] pageData route=/booking step=fetchActiveAgents duration=${Date.now() - t0}ms`)
  return {
    agents: data || [],
    error: error?.message || null,
  }
}

// Fetches active tours and active agents in a single server action using one
// Supabase client connection. Replaces the two separate useEffect calls on the
// booking page, halving connection round-trip overhead on initial mount.
export async function fetchBookingInitialData() {
  const actor = await requirePermission("booking_form_access")

  const t0 = Date.now()
  const supabase = await createClient()

  const [toursResult, agentsResult] = await Promise.all([
    supabase
      .from('tours')
      .select('*')
      .eq('active', true)
      .order('name'),
    supabase
      .from('app_users')
      .select('id, full_name, email')
      .eq('role', 'agent')
      .eq('active', true)
      .order('full_name', { ascending: true }),
  ])

  console.log(`[v0] pageData route=/booking step=fetchBookingInitialData duration=${Date.now() - t0}ms`)

  return {
    tours: toursResult.data || [],
    toursError: toursResult.error?.message || null,
    agents: actor.role === 'agent' ? [{id:actor.id,full_name:actor.full_name,email:actor.email}] : agentsResult.data || [],
    agentsError: agentsResult.error?.message || null,
  }
}

export async function fetchAvailableDates(tourId: string, guideId?: string) {
  await requirePermission("booking_form_access")

  const supabase = await createClient()
  
  // Get tour's max_capacity (default to 8 if missing)
  const { data: tour, error: tourError } = await supabase
    .from('tours')
    .select('max_capacity')
    .eq('id', tourId)
    .single()

  if (tourError || !tour || !Number.isInteger(tour.max_capacity)) return { availableDates: [], error: 'Tour capacity could not be verified.' }
  const maxCapacity = tour.max_capacity

  // Get open tour_dates for this tour
  const { data: tourDates, error: datesError } = await supabase
    .from('tour_dates')
    .select('id, tour_date, guide_user_id, capacity, guide:app_users!tour_dates_guide_user_id_fkey!inner(full_name,active,role)')
    .eq('guide.active',true).eq('guide.role','supplier')
    .match(guideId ? {guide_user_id:guideId} : {})
    .eq('tour_id', tourId)
    .eq('is_open', true)
    .order('tour_date', { ascending: true })

  if (datesError || !tourDates) {
    return { availableDates: [], error: datesError?.message || null }
  }

  // Single batched query: sum active participants for ALL these tour dates at once
  // (avoids the previous N+1 query-per-date loop).
  const participantsByDate = await getActiveParticipantsByDate(
    supabase,
    tourDates.map((td) => td.id)
  )

  const availableDates = []
  for (const td of tourDates) {
    const activeParticipants = participantsByDate.get(td.id) || 0
    const seatsLeft = td.capacity - activeParticipants

    if (seatsLeft > 0) {
      availableDates.push({
        id: td.id,
        guide_user_id: td.guide_user_id,
        tour_date: td.tour_date,
        seats_left: seatsLeft
      })
    }
  }

  return { availableDates, error: null }
}

// Batched helper: returns a Map of tour_date_id -> SUM(participants) for active
// reservations (WAITING FOR CONFIRMATION or CONFIRMED). One query for all dates.
async function getActiveParticipantsByDate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tourDateIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!tourDateIds.length) return map
  const { data, error } = await supabase.rpc('booking_participant_counts', { p_ids: tourDateIds })
  if (error) throw new Error('Availability could not be verified. Please try again.')
  for (const r of data ?? []) map.set(r.tour_date_id, Number(r.participants))
  return map
}

// Fetch tour dates for a specific month - includes closed/full dates for calendar display
export async function fetchTourDatesForCalendar(tourId: string, year: number, month: number, guideId?: string) {
  await requirePermission("booking_form_access")

  const t0 = Date.now()
  const supabase = await createClient()

  // Build date range for the month (pure JS, no DB call)
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Step 1 (parallel): tours.max_capacity and tour_dates for the month are
  // independent — neither depends on the other's result. Fire together.
  const tStep1 = Date.now()
  const [tourResult, { data: tourDates, error: datesError }] = await Promise.all([
    supabase
      .from('tours')
      .select('max_capacity')
      .eq('id', tourId)
      .single(),
    supabase
      .from('tour_dates')
      .select('id, tour_id, tour_date, is_open, supplier_status, guide_user_id, capacity, guide:app_users!tour_dates_guide_user_id_fkey!inner(full_name,active,role)')
      .eq('guide.active',true).eq('guide.role','supplier')
      .match(guideId ? {guide_user_id:guideId} : {})
      .eq('tour_id', tourId)
      .gte('tour_date', startDate)
      .lte('tour_date', endDate)
      .order('tour_date', { ascending: true }),
  ])
  if (tourResult.error || !tourResult.data) return { calendarDates: [], maxCapacity: 0, error: 'Tour capacity could not be verified.' }
  const maxCapacity = tourResult.data.max_capacity
  console.log(`[v0] pageData route=/booking step=fetchTourMaxCapacity+fetchCalendarTourDates parallel duration=${Date.now() - tStep1}ms`)

  if (datesError) {
    return { calendarDates: [], maxCapacity, error: datesError.message }
  }

  // Step 2: getActiveParticipantsByDate depends on tourDates ids — sequential.
  const tStep2 = Date.now()
  const participantsByDate = await getActiveParticipantsByDate(
    supabase,
    (tourDates || []).map((td) => td.id)
  )
  console.log(`[v0] pageData route=/booking step=fetchActiveParticipantsByDate duration=${Date.now() - tStep2}ms`)

  const calendarDates = (tourDates || []).map((td) => {
    const activeParticipants = participantsByDate.get(td.id) || 0
    const seatsLeft = td.capacity - activeParticipants
    return {
      id: td.id,
        guide_user_id: td.guide_user_id,
      tour_id: td.tour_id,
      tour_date: td.tour_date,
      is_open: td.is_open,
      supplier_status: td.supplier_status,
      seats_left: seatsLeft,
      is_full: seatsLeft <= 0
    }
  })

  console.log(`[v0] pageData route=/booking step=fetchTourDatesForCalendar total=${Date.now() - t0}ms`)
  return { calendarDates, maxCapacity, error: null }
}

export async function submitBooking(formData: FormData) {
  const actor = await requirePermission('booking_form_access')
  const participants = Number(formData.get('participants'))
  if (!Number.isSafeInteger(participants) || participants < 1) return { success: false, error: 'Participants must be a positive whole number.' }
  const input = Object.fromEntries(['guide_user_id','tour_id','tour_date_id','selected_tour_date','reservation_number','voucher_number','lead_passenger_name','whatsapp_number','agent_user_id'].map(key => [key, String(formData.get(key) ?? '').trim()]))
  const { data, error } = await createClient().rpc('booking_create', { p_actor: actor.id, p_input: { ...input, participants } })
  if (error || !data) return { success: false, error: error?.code === '23505' ? 'This voucher is already booked. Check the existing booking before trying again.' : error?.message ?? 'Booking was not saved.' }
  await syncDates([data.tour_date_id])
  await deliverReservationEmails([data.id])
  refreshBookingPages()
  return { success: true }
}
