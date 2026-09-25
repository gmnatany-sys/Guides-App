'use server'

import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { revalidatePath } from 'next/cache'
import { transitionReservation } from '@/lib/booking-workflows'

export async function fetchReservationsByStatus(status: string, search?: string, offset = 0) {
  const actor = await requirePermission("supplier_confirmation_view")

  const t0 = Date.now()
  const supabase = await createClient()

  let query = supabase
    .from('reservations')
    .select('*, tours(name), tour_dates!inner(tour_date, guide_user_id, guide:app_users!tour_dates_guide_user_id_fkey(full_name))')
    .match(actor.role === 'supplier' ? {'tour_dates.guide_user_id':actor.id} : {})
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
  const actor = await requirePermission("supplier_confirmation_view")

  const t0 = Date.now()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('booking_supplier_counts', { p_actor: actor.id })
  if (error || !data) throw new Error('Reservation counts could not be loaded.')
  return data as {waiting:number;confirmed:number;notConfirmed:number;cancelled:number}
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
