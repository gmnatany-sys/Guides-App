'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createEmailLog } from '@/lib/email-log'
import { syncMinimumParticipantsForTourDate } from '@/app/admin/alerts/actions'

export async function fetchReservationsByStatus(status: string, search?: string) {
  const t0 = Date.now()
  const supabase = await createClient()

  let query = supabase
    .from('reservations')
    .select('*, tours(name), tour_dates(tour_date)')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100)

  if (search && search.trim()) {
    const searchTerm = search.trim()
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
  return {
    waiting: waiting.count || 0,
    confirmed: confirmed.count || 0,
    notConfirmed: notConfirmed.count || 0,
    cancelled: cancelled.count || 0,
  }
}

async function getNextConfirmationNumber(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from('reservations')
    .select('confirmation_number')
    .not('confirmation_number', 'is', null)
    .order('confirmation_number', { ascending: false })
    .limit(1)

  if (data && data.length > 0 && data[0].confirmation_number) {
    const lastNum = parseInt(data[0].confirmation_number.replace('JT-', ''), 10)
    return `JT-${lastNum + 1}`
  }
  return 'JT-1001'
}

export async function supplierConfirmBooking(reservationId: string) {
  try {
    const supabase = await createClient()

    const { data: reservation } = await supabase
      .from('reservations')
      .select('status, confirmation_number, voucher_number, reservation_number, tour_date_id')
      .eq('id', reservationId)
      .single()

    if (!reservation) {
      return { success: false, error: 'Reservation not found.' }
    }

    if (reservation.status === 'CANCELLED') {
      return { success: false, error: 'This booking has already been cancelled.' }
    }

    let confirmationNumber = reservation.confirmation_number
    if (!confirmationNumber) {
      confirmationNumber = await getNextConfirmationNumber(supabase)
    }

    const { error } = await supabase
      .from('reservations')
      .update({
        status: 'CONFIRMED',
        confirmation_number: confirmationNumber,
        supplier_response_at: new Date().toISOString()
      })
      .eq('id', reservationId)

    if (error) {
      return { success: false, error: error.message }
    }

    // Live minimum-participants sync for this date only (never blocks the action).
    if (reservation.tour_date_id) {
      try {
        await syncMinimumParticipantsForTourDate(reservation.tour_date_id)
      } catch (err) {
        console.error('[v0] minimum-participants sync failed after supplier confirm:', err)
      }
    }

    // Status update succeeded. Email sending must NOT block or revert this.
    let emailSent = false
    let emailError: string | undefined
    try {
      const emailResult = await createEmailLog({
        reservationId,
        emailType: 'CONFIRMED',
        fromEmail: 'info@yapantours.com',
        toEmail: 'reservation@yapantours.com',
        cc: 'gmnatany@yapantours.com,itai@mitiya.co',
        subject: `Tour Reservation Confirmed - Confirmation #${confirmationNumber}`
      })
      emailSent = emailResult.success
      emailError = emailResult.error
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Email sending failed.'
    }

    revalidatePath('/supplier/confirm')
    revalidatePath('/admin/reservations')
    return {
      success: true,
      confirmationNumber,
      reservationUpdated: true,
      emailSent,
      emailError,
      warning: emailSent ? undefined : 'Booking confirmed, but confirmation email failed. Check Email Logs.'
    }
  } catch (err) {
    console.error('[v0] supplierConfirmBooking failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Failed to confirm booking.' }
  }
}

export async function supplierMarkNotConfirmed(reservationId: string) {
  try {
    const supabase = await createClient()

    const { data: reservation } = await supabase
      .from('reservations')
      .select('status, voucher_number, reservation_number, tour_date_id')
      .eq('id', reservationId)
      .single()

    if (!reservation) {
      return { success: false, error: 'Reservation not found.' }
    }

    if (reservation.status === 'CANCELLED') {
      return { success: false, error: 'This booking has already been cancelled.' }
    }

    const { error } = await supabase
      .from('reservations')
      .update({
        status: 'NOT CONFIRMED',
        supplier_response_at: new Date().toISOString()
      })
      .eq('id', reservationId)

    if (error) {
      return { success: false, error: error.message }
    }

    if (reservation.tour_date_id) {
      try {
        await syncMinimumParticipantsForTourDate(reservation.tour_date_id)
      } catch (err) {
        console.error('[v0] minimum-participants sync failed after not-confirmed:', err)
      }
    }

    let emailSent = false
    let emailError: string | undefined
    try {
      const emailResult = await createEmailLog({
        reservationId,
        emailType: 'NOT_CONFIRMED',
        fromEmail: 'info@yapantours.com',
        toEmail: 'reservation@yapantours.com',
        cc: 'gmnatany@yapantours.com',
        subject: `Tour Reservation Not Confirmed - Voucher #${reservation.voucher_number || reservation.reservation_number}`
      })
      emailSent = emailResult.success
      emailError = emailResult.error
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Email sending failed.'
    }

    revalidatePath('/supplier/confirm')
    revalidatePath('/admin/reservations')
    return {
      success: true,
      reservationUpdated: true,
      emailSent,
      emailError,
      warning: emailSent ? undefined : 'Marked Not Confirmed, but email failed. Check Email Logs.'
    }
  } catch (err) {
    console.error('[v0] supplierMarkNotConfirmed failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update booking.' }
  }
}

export async function supplierCancelBooking(reservationId: string) {
  try {
    const supabase = await createClient()

    const { data: reservation } = await supabase
      .from('reservations')
      .select('status, internal_notes, voucher_number, reservation_number, tour_date_id')
      .eq('id', reservationId)
      .single()

    if (!reservation) {
      return { success: false, error: 'Reservation not found.' }
    }

    if (reservation.status === 'CANCELLED') {
      return { success: false, error: 'This booking has already been cancelled.' }
    }

    const cancelNote = 'Cancelled by supplier from Supplier Confirmation page.'
    const updatedNotes = reservation.internal_notes 
      ? `${reservation.internal_notes}\n${cancelNote}` 
      : cancelNote

    const { error } = await supabase
      .from('reservations')
      .update({
        status: 'CANCELLED',
        cancelled_at: new Date().toISOString(),
        internal_notes: updatedNotes
      })
      .eq('id', reservationId)

    if (error) {
      return { success: false, error: error.message }
    }

    if (reservation.tour_date_id) {
      try {
        await syncMinimumParticipantsForTourDate(reservation.tour_date_id)
      } catch (err) {
        console.error('[v0] minimum-participants sync failed after supplier cancel:', err)
      }
    }

    let emailSent = false
    let emailError: string | undefined
    try {
      const emailResult = await createEmailLog({
        reservationId,
        emailType: 'CANCELLED',
        fromEmail: 'info@yapantours.com',
        toEmail: 'itai@mitiya.co',
        cc: 'reservation@yapantours.com,gmnatany@yapantours.com',
        subject: `Tour Reservation Cancelled - Voucher #${reservation.voucher_number || reservation.reservation_number}`
      })
      emailSent = emailResult.success
      emailError = emailResult.error
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Email sending failed.'
    }

    revalidatePath('/supplier/confirm')
    revalidatePath('/admin/reservations')
    return {
      success: true,
      reservationUpdated: true,
      emailSent,
      emailError,
      warning: emailSent ? undefined : 'Booking cancelled, but email failed. Check Email Logs.'
    }
  } catch (err) {
    console.error('[v0] supplierCancelBooking failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Failed to cancel booking.' }
  }
}
