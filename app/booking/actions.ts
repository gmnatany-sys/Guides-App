'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createEmailLog } from '@/lib/email-log'
import { syncMinimumParticipantsForTourDate } from '@/app/admin/alerts/actions'

export async function fetchActiveTours() {
  const t0 = performance.now()
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('tours')
    .select('*')
    .eq('active', true)
    .order('name')

  console.log(`[perf] /booking fetchActiveTours: ${Math.round(performance.now() - t0)}ms — ${data?.length ?? 0} rows`)
  return {
    tours: data || [],
    error: error?.message || null
  }
}

// Active agents for the booking form's Agent dropdown.
export async function fetchActiveAgents() {
  const t0 = performance.now()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('app_users')
    .select('id, full_name, email')
    .eq('role', 'agent')
    .eq('active', true)
    .order('full_name', { ascending: true })

  console.log(`[perf] /booking fetchActiveAgents: ${Math.round(performance.now() - t0)}ms — ${data?.length ?? 0} rows`)
  return {
    agents: data || [],
    error: error?.message || null,
  }
}

export async function fetchAvailableDates(tourId: string) {
  const supabase = await createClient()
  
  // Get tour's max_capacity (default to 8 if missing)
  const { data: tour } = await supabase
    .from('tours')
    .select('max_capacity')
    .eq('id', tourId)
    .single()

  const maxCapacity = tour?.max_capacity || 8

  // Get open tour_dates for this tour
  const { data: tourDates, error: datesError } = await supabase
    .from('tour_dates')
    .select('id, tour_date')
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
    const seatsLeft = maxCapacity - activeParticipants

    if (seatsLeft > 0) {
      availableDates.push({
        id: td.id,
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
  if (tourDateIds.length === 0) return map

  const { data } = await supabase
    .from('reservations')
    .select('tour_date_id, participants')
    .in('tour_date_id', tourDateIds)
    .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])

  for (const r of data || []) {
    map.set(r.tour_date_id, (map.get(r.tour_date_id) || 0) + (r.participants || 0))
  }
  return map
}

// Fetch tour dates for a specific month - includes closed/full dates for calendar display.
// Uses a single Supabase join (tour_dates → tours) to retrieve max_capacity and dates
// together, then a second batched reservations query — total: 2 round trips instead of 3.
export async function fetchTourDatesForCalendar(tourId: string, year: number, month: number) {
  const t0 = performance.now()
  const supabase = await createClient()

  // Build date range for the month
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Single round-trip: get ALL tour_dates for this tour in the date range AND the tour's
  // max_capacity via a join — eliminates the separate "get tour" query that ran first.
  const { data: tourDates, error: datesError } = await supabase
    .from('tour_dates')
    .select('id, tour_id, tour_date, is_open, supplier_status, tours!inner(max_capacity)')
    .eq('tour_id', tourId)
    .gte('tour_date', startDate)
    .lte('tour_date', endDate)
    .order('tour_date', { ascending: true })

  if (datesError) {
    return { calendarDates: [], maxCapacity: 8, error: datesError.message }
  }

  // Pull max_capacity out of the first row (same tour → same capacity for all rows).
  const maxCapacity =
    (tourDates?.[0]?.tours as { max_capacity?: number | null } | null)?.max_capacity ?? 8

  // Second query: batch-fetch participant counts for all dates in the month.
  const participantsByDate = await getActiveParticipantsByDate(
    supabase,
    (tourDates || []).map((td) => td.id)
  )

  const calendarDates = (tourDates || []).map((td) => {
    const activeParticipants = participantsByDate.get(td.id) || 0
    const seatsLeft = maxCapacity - activeParticipants
    return {
      id: td.id,
      tour_id: td.tour_id,
      tour_date: td.tour_date,
      is_open: td.is_open,
      supplier_status: td.supplier_status,
      seats_left: seatsLeft,
      is_full: seatsLeft <= 0
    }
  })

  console.log(`[perf] /booking fetchTourDatesForCalendar: ${Math.round(performance.now() - t0)}ms — ${calendarDates.length} dates (2 queries: join + reservations batch)`)
  return { calendarDates, maxCapacity, error: null }
}

export async function submitBooking(formData: FormData) {
  const tourId = formData.get('tour_id') as string
  const tourDateId = formData.get('tour_date_id') as string
  const reservationNumber = formData.get('reservation_number') as string
  const voucherNumber = formData.get('voucher_number') as string
  const leadPassengerName = formData.get('lead_passenger_name') as string
  const whatsappNumber = formData.get('whatsapp_number') as string
  const participants = parseInt(formData.get('participants') as string, 10)
  const agentUserId = formData.get('agent_user_id') as string

  // Validate ALL required fields
  const missingFields: string[] = []
  if (!tourId) missingFields.push('Tour')
  if (!tourDateId) missingFields.push('Available Date')
  if (!reservationNumber?.trim()) missingFields.push('Docket Number')
  if (!voucherNumber?.trim()) missingFields.push('Voucher Number')
  if (!leadPassengerName?.trim()) missingFields.push('Lead Passenger Name')
  if (!whatsappNumber?.trim()) missingFields.push('WhatsApp Number')
  if (!participants || isNaN(participants)) missingFields.push('Number of Participants')
  if (!agentUserId?.trim()) missingFields.push('Agent')

  if (missingFields.length > 0) {
    return { success: false, error: `Please fill in all required fields: ${missingFields.join(', ')}` }
  }

  if (participants < 1) {
    return { success: false, error: 'Number of participants must be at least 1.' }
  }

  const supabase = await createClient()

  // The exact tour_date the client believed it was booking (for cross-check / logging).
  const selectedTourDateLabel = (formData.get('selected_tour_date') as string) || null

  // SERVER-SIDE VERIFICATION (data integrity): fetch the selected tour_date by ID and
  // confirm it is valid and belongs to the selected tour. This prevents a stale or
  // mismatched tour_date_id (e.g. left over from a previous tour/month) from ever being
  // saved against the wrong date.
  const { data: selectedTourDate, error: tourDateError } = await supabase
    .from('tour_dates')
    .select('id, tour_id, tour_date, is_open, supplier_status')
    .eq('id', tourDateId)
    .maybeSingle()

  if (tourDateError || !selectedTourDate) {
    return { success: false, error: 'The selected tour date could not be found. Please re-select a date.' }
  }
  if (selectedTourDate.tour_id !== tourId) {
    console.error('[v0] booking tour_date/tour mismatch:', { tourId, tourDateId, tourDateTourId: selectedTourDate.tour_id })
    return { success: false, error: 'The selected date does not belong to the selected tour. Please re-select a date.' }
  }
  if (!selectedTourDate.is_open) {
    return { success: false, error: 'The selected tour date is no longer open for booking. Please choose another date.' }
  }
  if (selectedTourDate.supplier_status === 'CANCELLED') {
    return { success: false, error: 'The selected tour date has been cancelled. Please choose another date.' }
  }
  // If the client sent a date label, it must match the authoritative DB date.
  if (selectedTourDateLabel && selectedTourDateLabel !== selectedTourDate.tour_date) {
    console.error('[v0] booking date label mismatch:', { selectedTourDateLabel, dbTourDate: selectedTourDate.tour_date, tourDateId })
    return { success: false, error: 'The selected date is out of sync. Please re-select the date and try again.' }
  }

  // SERVER-SIDE VALIDATION: Recalculate seats_left to prevent race conditions / overbooking
  // Get tour's max_capacity (default to 8 if missing)
  const { data: tour } = await supabase
    .from('tours')
    .select('max_capacity')
    .eq('id', tourId)
    .single()

  const maxCapacity = tour?.max_capacity || 8

  // Calculate active participants for this tour_date
  const { data: existingReservations } = await supabase
    .from('reservations')
    .select('participants')
    .eq('tour_date_id', tourDateId)
    .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])

  const activeParticipants = existingReservations?.reduce((sum, r) => sum + (r.participants || 0), 0) || 0
  const seatsLeft = maxCapacity - activeParticipants

  // Validate: requested participants must not exceed available seats
  if (participants > seatsLeft) {
    return { 
      success: false, 
      error: `Not enough seats left. Only ${seatsLeft} seat${seatsLeft !== 1 ? 's' : ''} available.` 
    }
  }

  // Resolve agent details server-side from app_users (don't trust client-sent
  // name/email). The agent must be an active agent.
  const { data: agent } = await supabase
    .from('app_users')
    .select('id, full_name, email')
    .eq('id', agentUserId)
    .eq('role', 'agent')
    .eq('active', true)
    .maybeSingle()

  if (!agent) {
    return { success: false, error: 'Selected agent is not valid. Please choose an active agent.' }
  }

  // Insert reservation
  const { data: newReservation, error } = await supabase.from('reservations').insert({
    reservation_number: reservationNumber.trim(),
    voucher_number: voucherNumber.trim(),
    lead_passenger_name: leadPassengerName.trim(),
    whatsapp_number: whatsappNumber.trim(),
    participants: participants,
    tour_id: tourId,
    tour_date_id: tourDateId,
    status: 'WAITING FOR CONFIRMATION',
    agent_user_id: agent.id,
    agent_name: agent.full_name,
    agent_email: agent.email,
  }).select('id').single()

  if (error) {
    return { success: false, error: error.message }
  }

  // POST-INSERT VERIFICATION: re-fetch the inserted reservation joined to its tour_date
  // and confirm the persisted date matches what the user selected. If it does not, this
  // is a critical data-integrity failure — surface an error and DO NOT send the email.
  if (newReservation) {
    const { data: verifyRow } = await supabase
      .from('reservations')
      .select('id, tour_date_id, tour_dates(tour_date)')
      .eq('id', newReservation.id)
      .single()

    const persistedTourDate = (verifyRow?.tour_dates as { tour_date?: string } | null)?.tour_date || null

    // Debug snapshot of the full date chain (requirement #9).
    console.log('[v0] booking submit verification:', {
      selectedTourId: tourId,
      submittedTourDateId: tourDateId,
      selectedTourDate: selectedTourDate.tour_date,
      insertedReservationId: newReservation.id,
      insertedTourDateId: verifyRow?.tour_date_id,
      persistedTourDate,
    })

    if (verifyRow?.tour_date_id !== tourDateId || persistedTourDate !== selectedTourDate.tour_date) {
      console.error('[v0] CRITICAL booking date mismatch after insert:', {
        submittedTourDateId: tourDateId,
        expectedTourDate: selectedTourDate.tour_date,
        insertedTourDateId: verifyRow?.tour_date_id,
        persistedTourDate,
      })
      return {
        success: false,
        error: 'Booking saved with an inconsistent date. Please contact support and do not rebook this voucher.',
      }
    }
  }

  // Create email log for new booking. Email failure must NOT block the booking.
  if (newReservation) {
    try {
      await createEmailLog({
        reservationId: newReservation.id,
        emailType: 'NEW_BOOKING',
        fromEmail: 'reservation@yapantours.com',
        toEmail: 'itai@mitiya.co',
        cc: 'gmnatany@yapantours.com',
        subject: `New Tour Reservation - Voucher #${voucherNumber || reservationNumber}`
      })
    } catch (err) {
      console.error('[v0] new booking email failed (reservation still saved):', err)
    }
  }

  // Live minimum-participants sync for this date only (never blocks the booking).
  try {
    await syncMinimumParticipantsForTourDate(tourDateId)
  } catch (err) {
    console.error('[v0] minimum-participants sync failed after booking:', err)
  }

  revalidatePath('/booking')
  revalidatePath('/admin/reservations')
  return { success: true }
}
