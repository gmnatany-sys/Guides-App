'use server'

import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { revalidatePath } from 'next/cache'
import { transitionReservation } from '@/lib/booking-workflows'

export async function fetchReservationsByStatus(status: string, search?: string, offset = 0) {
  await requirePermission("supplier_confirmation_view")

  const t0 = Date.now()
  const supabase = await createClient()

  let query = supabase
    .from('reservations')
    .select('*, tours(name), tour_dates(tour_date)')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(Math.max(0,Math.floor(offset)), Math.max(0,Math.floor(offset))+99)

  if (search && search.trim()) {
    const searchTerm = safeSearch(search)
    query = query.or(`voucher_number.ilike.%${searchTerm}%,reservation_number.ilike.%${searchTerm}%,lead_passenger_name.ilike.%${searchTerm}%`)
  }

  const { data, error } = await query
  console.log(`[v0] pageData route=/supplier/confirm step=fetchReservationsByStatus status=${status} duration=${Date.now() - t0}ms`)

  if (error) {
    return { reservations: [], error: error.message }
  }

  return { reservations: data || [], error: null }
}

export async function fetchAllReservationCounts() {
  await requirePermission("supplier_confirmation_view")

  const t0 = Date.now()
  const supabase = await createClient()

  // Single RPC call replaces 4 parallel COUNT queries — one round trip, one
  // connection, same result shape. Falls back to 4 parallel queries if the RPC
  // fails (e.g. function not yet deployed to this environment).
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_reservation_status_counts')
  console.log(`[v0] pageData route=/supplier/confirm step=fetchAllReservationCounts duration=${Date.now() - t0}ms`)

  if (!rpcError && rpcData) {
    const counts = { waiting: 0, confirmed: 0, notConfirmed: 0, cancelled: 0 }
    for (const row of rpcData as { status: string; count: number }[]) {
      if (row.status === 'WAITING FOR CONFIRMATION') counts.waiting = Number(row.count)
      else if (row.status === 'CONFIRMED') counts.confirmed = Number(row.count)
      else if (row.status === 'NOT CONFIRMED') counts.notConfirmed = Number(row.count)
      else if (row.status === 'CANCELLED') counts.cancelled = Number(row.count)
    }
    return counts
  }

  // Fallback: RPC unavailable — use original 4 parallel queries.
  console.log(`[v0] fetchAllReservationCounts RPC failed, falling back: ${rpcError?.message}`)
  const [waiting, confirmed, notConfirmed, cancelled] = await Promise.all([
    supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'WAITING FOR CONFIRMATION'),
    supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'CONFIRMED'),
    supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'NOT CONFIRMED'),
    supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'CANCELLED'),
  ])
  if ([waiting,confirmed,notConfirmed,cancelled].some(result => result.error)) throw new Error('Reservation counts could not be loaded.')
  return {
    waiting: waiting.count || 0,
    confirmed: confirmed.count || 0,
    notConfirmed: notConfirmed.count || 0,
    cancelled: cancelled.count || 0,
  }
}


export async function supplierConfirmBooking(reservationId: string) {
 return transitionReservation(reservationId, 'CONFIRMED', 'supplier_confirmation_action', 'Supplier action.')
}

export async function supplierMarkNotConfirmed(reservationId: string) {
 return transitionReservation(reservationId, 'NOT CONFIRMED', 'supplier_confirmation_action', 'Supplier action.')
}

export async function supplierCancelBooking(reservationId: string) {
 return transitionReservation(reservationId, 'CANCELLED', 'supplier_confirmation_action', 'Supplier action.')
}
