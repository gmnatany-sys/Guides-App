'use server'

import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { revalidatePath } from 'next/cache'
import { transitionReservation } from '@/lib/booking-workflows'

export interface ReservationFilters {
  status?: string
  tourId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  offset?: number
}

export async function fetchReservations(filters: ReservationFilters = {}) {
  await requirePermission("reservations_view_access")

  if (filters.search || filters.status || filters.tourId || filters.dateFrom || filters.dateTo) await requirePermission('reservations_search_access')
  const offset = Math.max(0, Math.floor(filters.offset ?? 0))
  const t0 = Date.now()
  const supabase = await createClient()
  
  let query = supabase
    .from('reservations')
    .select('*, tours(name), tour_dates(tour_date,guide:app_users!tour_dates_guide_user_id_fkey(full_name))')
    .order('created_at', { ascending: false })
    // Default to the latest 100 records; all filters/search are applied server-side.
    .order('id', { ascending: false })
    .range(offset, offset + 99)

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }

  if (filters.tourId && filters.tourId !== 'all') {
    query = query.eq('tour_id', filters.tourId)
  }

  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom)
  }

  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo + 'T23:59:59')
  }

  if (filters.search) {
    const searchTerm = safeSearch(filters.search)
    if (searchTerm) {
      query = query.or(`reservation_number.ilike.%${searchTerm}%,voucher_number.ilike.%${searchTerm}%,lead_passenger_name.ilike.%${searchTerm}%,confirmation_number.ilike.%${searchTerm}%`)
    }
  }

  const { data, error } = await query

  console.log(`[v0] pageData route=/admin/reservations step=fetchReservations duration=${Date.now() - t0}ms`)

  return {
    reservations: data || [],
    error: error?.message || null
  }
}

export async function fetchTours() {
  await requirePermission("reservations_view_access")

  const t0 = Date.now()
  const supabase = await createClient()
  const { data, error } = await supabase.from('tours').select('id, name').order('name')
  console.log(`[v0] pageData route=/admin/reservations step=fetchTours duration=${Date.now() - t0}ms`)
  return {
    tours: data || [],
    error: error?.message || null
  }
}


export async function confirmReservation(reservationId: string) {
 return transitionReservation(reservationId, 'CONFIRMED', 'reservations_action_access', 'Reservations management action.')
}

export async function markNotConfirmed(reservationId: string) {
 return transitionReservation(reservationId, 'NOT CONFIRMED', 'reservations_action_access', 'Reservations management action.')
}

export async function cancelReservation(reservationId: string) {
 return transitionReservation(reservationId, 'CANCELLED', 'reservations_action_access', 'Reservations management action.')
}
