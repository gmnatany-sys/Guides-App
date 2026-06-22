'use server'

import { createClient } from '@/lib/supabase/server'

export interface TourAvailability {
  tour_id: string
  tour_name: string
  tour_short_name: string
  tour_date_id: string
  tour_date: string
  is_open: boolean
  supplier_status: string | null
  max_capacity: number
  active_participants: number
  seats_left: number
  availability_status: 'OPEN' | 'ALMOST_FULL' | 'FULL' | 'CLOSED' | 'CANCELLED'
}

// Fetch all active tours for the filter dropdown
export async function fetchToursForFilter() {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('tours')
    .select('id, name')
    .eq('active', true)
    .order('name')

  return {
    tours: data || [],
    error: error?.message || null
  }
}

// Batched helper: returns a Map of tour_date_id -> SUM(participants) for active
// reservations (WAITING FOR CONFIRMATION or CONFIRMED). One query for all dates,
// replacing the previous N+1 query-per-date loops that made this page slow.
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

// Get short name for tour (first word)
function getShortTourName(name: string): string {
  const firstWord = name.split(' ')[0].toUpperCase()
  return firstWord.length > 10 ? firstWord.slice(0, 10) : firstWord
}

// Calculate availability status based on is_open and seats_left
function getAvailabilityStatus(
  isOpen: boolean, 
  supplierStatus: string | null, 
  seatsLeft: number
): 'OPEN' | 'ALMOST_FULL' | 'FULL' | 'CLOSED' | 'CANCELLED' {
  if (supplierStatus === 'CANCELLED') return 'CANCELLED'
  if (!isOpen) return 'CLOSED'
  if (seatsLeft <= 0) return 'FULL'
  if (seatsLeft <= 3) return 'ALMOST_FULL'
  return 'OPEN'
}

// Fetch availability for calendar view (specific month)
export async function fetchAvailabilityForCalendar(
  year: number, 
  month: number, 
  tourId?: string // optional filter by tour
) {
  const supabase = await createClient()
  
  // Build date range for the month
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // Get all tours with their max_capacity
  const { data: tours } = await supabase
    .from('tours')
    .select('id, name, max_capacity')
    .eq('active', true)

  if (!tours) {
    return { availability: [], error: 'Failed to load tours' }
  }

  // Create a map of tour id to tour info
  const tourMap = new Map(tours.map(t => [t.id, { name: t.name, max_capacity: t.max_capacity || 8 }]))

  // Build query for tour_dates
  let query = supabase
    .from('tour_dates')
    .select('id, tour_id, tour_date, is_open, supplier_status')
    .gte('tour_date', startDate)
    .lte('tour_date', endDate)
    .order('tour_date', { ascending: true })

  // Filter by specific tour if provided
  if (tourId && tourId !== 'all') {
    query = query.eq('tour_id', tourId)
  }

  const { data: tourDates, error: datesError } = await query

  if (datesError) {
    return { availability: [], error: datesError.message }
  }

  // Single batched query for participant sums across all dates in the month.
  const participantsByDate = await getActiveParticipantsByDate(
    supabase,
    (tourDates || []).map((td) => td.id)
  )

  const availability: TourAvailability[] = []
  
  for (const td of tourDates || []) {
    const tourInfo = tourMap.get(td.tour_id)
    if (!tourInfo) continue

    const activeParticipants = participantsByDate.get(td.id) || 0
    const seatsLeft = tourInfo.max_capacity - activeParticipants
    const availabilityStatus = getAvailabilityStatus(td.is_open, td.supplier_status, seatsLeft)

    availability.push({
      tour_id: td.tour_id,
      tour_name: tourInfo.name,
      tour_short_name: getShortTourName(tourInfo.name),
      tour_date_id: td.id,
      tour_date: td.tour_date,
      is_open: td.is_open,
      supplier_status: td.supplier_status,
      max_capacity: tourInfo.max_capacity,
      active_participants: activeParticipants,
      seats_left: seatsLeft,
      availability_status: availabilityStatus
    })
  }

  return { availability, error: null }
}

// Fetch upcoming availability list (next 60 days)
export async function fetchUpcomingAvailability(tourId?: string) {
  const supabase = await createClient()
  
  // Calculate date range: today to 60 days from now
  const today = new Date()
  const startDate = today.toISOString().split('T')[0]
  const endDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Get all tours with their max_capacity
  const { data: tours } = await supabase
    .from('tours')
    .select('id, name, max_capacity')
    .eq('active', true)

  if (!tours) {
    return { upcoming: [], error: 'Failed to load tours' }
  }

  // Create a map of tour id to tour info
  const tourMap = new Map(tours.map(t => [t.id, { name: t.name, max_capacity: t.max_capacity || 8 }]))

  // Build query for tour_dates - only fetch open dates for the list
  let query = supabase
    .from('tour_dates')
    .select('id, tour_id, tour_date, is_open, supplier_status')
    .gte('tour_date', startDate)
    .lte('tour_date', endDate)
    .order('tour_date', { ascending: true })

  // Filter by specific tour if provided
  if (tourId && tourId !== 'all') {
    query = query.eq('tour_id', tourId)
  }

  const { data: tourDates, error: datesError } = await query

  if (datesError) {
    return { upcoming: [], error: datesError.message }
  }

  // Single batched query for participant sums across all upcoming dates.
  const participantsByDate = await getActiveParticipantsByDate(
    supabase,
    (tourDates || []).map((td) => td.id)
  )

  const upcoming: TourAvailability[] = []
  
  for (const td of tourDates || []) {
    const tourInfo = tourMap.get(td.tour_id)
    if (!tourInfo) continue

    const activeParticipants = participantsByDate.get(td.id) || 0
    const seatsLeft = tourInfo.max_capacity - activeParticipants
    const availabilityStatus = getAvailabilityStatus(td.is_open, td.supplier_status, seatsLeft)

    upcoming.push({
      tour_id: td.tour_id,
      tour_name: tourInfo.name,
      tour_short_name: getShortTourName(tourInfo.name),
      tour_date_id: td.id,
      tour_date: td.tour_date,
      is_open: td.is_open,
      supplier_status: td.supplier_status,
      max_capacity: tourInfo.max_capacity,
      active_participants: activeParticipants,
      seats_left: seatsLeft,
      availability_status: availabilityStatus
    })
  }

  return { upcoming, error: null }
}
