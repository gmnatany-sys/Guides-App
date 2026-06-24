'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { syncMinimumParticipantsForTourDate } from '@/app/admin/alerts/actions'
import { createEmailLog } from '@/lib/email-log'

export interface ReservationFilters {
  status?: string
  tourId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

export async function fetchReservations(filters: ReservationFilters = {}) {
  const t0 = Date.now()
  const supabase = await createClient()
  
  let query = supabase
    .from('reservations')
    .select('*, tours(name), tour_dates(tour_date)')
    .order('created_at', { ascending: false })
    // Default to the latest 100 records; all filters/search are applied server-side.
    .limit(100)

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
    const searchTerm = filters.search.trim()
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
  const t0 = Date.now()
  const supabase = await createClient()
  const { data, error } = await supabase.from('tours').select('id, name').order('name')
  console.log(`[v0] pageData route=/admin/reservations step=fetchTours duration=${Date.now() - t0}ms`)
  return {
    tours: data || [],
    error: error?.message || null
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

export async function confirmReservation(reservationId: string) {
  const supabase = await createClient()

  // Get current reservation to check if it already has a confirmation number
  const { data: reservation } = await supabase
    .from('reservations')
    .select('confirmation_number, tour_date_id')
    .eq('id', reservationId)
    .single()

  let confirmationNumber = reservation?.confirmation_number
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

  if (reservation?.tour_date_id) {
    try {
      await syncMinimumParticipantsForTourDate(reservation.tour_date_id)
    } catch (err) {
      console.error('[v0] minimum-participants sync failed after confirm:', err)
    }
  }

  revalidatePath('/admin/reservations')
  return { success: true, confirmationNumber }
}

export async function markNotConfirmed(reservationId: string) {
  const supabase = await createClient()

  const { data: reservation } = await supabase
    .from('reservations')
    .select('tour_date_id')
    .eq('id', reservationId)
    .single()

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

  if (reservation?.tour_date_id) {
    try {
      await syncMinimumParticipantsForTourDate(reservation.tour_date_id)
    } catch (err) {
      console.error('[v0] minimum-participants sync failed after not-confirmed:', err)
    }
  }

  revalidatePath('/admin/reservations')
  return { success: true }
}

export async function cancelReservation(reservationId: string) {
  try {
    const supabase = await createClient()

    const { data: reservation } = await supabase
      .from('reservations')
      .select('status, internal_notes, voucher_number, reservation_number, tour_date_id, agent_email')
      .eq('id', reservationId)
      .single()

    if (!reservation) {
      return { success: false, error: 'Reservation not found.' }
    }

    if (reservation.status === 'CANCELLED') {
      return { success: false, error: 'This reservation has already been cancelled.' }
    }

    // Append the standard reason to the internal notes (requirement #1).
    const cancelNote = 'Cancelled from Reservations Management.'
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

    // Keep minimum-participants alerts in sync (non-blocking).
    if (reservation.tour_date_id) {
      try {
        await syncMinimumParticipantsForTourDate(reservation.tour_date_id)
      } catch (err) {
        console.error('[v0] minimum-participants sync failed after cancel:', err)
      }
    }

    // DUPLICATE PREVENTION: if a CANCELLED email was already SENT for this
    // reservation, do not send another one.
    const { data: alreadySent } = await supabase
      .from('email_logs')
      .select('id')
      .eq('reservation_id', reservationId)
      .eq('email_type', 'CANCELLED')
      .eq('status', 'SENT')
      .limit(1)

    if (alreadySent && alreadySent.length > 0) {
      revalidatePath('/admin/reservations')
      return {
        success: true,
        emailSent: true,
        emailAlreadySent: true,
        warning: undefined as string | undefined
      }
    }

    // Reuse rather than duplicate: clear any stale non-SENT CANCELLED logs
    // (PENDING / FAILED / ERROR) for this reservation before sending a fresh one.
    await supabase
      .from('email_logs')
      .delete()
      .eq('reservation_id', reservationId)
      .eq('email_type', 'CANCELLED')
      .neq('status', 'SENT')

    // Send the CANCELLED email via the same Resend pipeline (createEmailLog) used by
    // Supplier Confirmation, Availability Calendar, and Minimum Participants flows.
    const ccList = ['gmnatany@yapantours.com', 'itai@mitiya.co']
    if (reservation.agent_email) {
      ccList.push(reservation.agent_email)
    }

    let emailSent = false
    let emailError: string | undefined
    try {
      const emailResult = await createEmailLog({
        reservationId,
        emailType: 'CANCELLED',
        fromEmail: 'info@yapantours.com',
        toEmail: 'reservation@yapantours.com',
        cc: ccList.join(','),
        subject: `Tour Reservation Cancelled - Voucher #${reservation.voucher_number || reservation.reservation_number}`
      })
      emailSent = emailResult.success
      emailError = emailResult.error
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Email sending failed.'
      console.error('[v0] cancelReservation email send failed:', emailError)
    }

    revalidatePath('/admin/reservations')
    return {
      success: true,
      emailSent,
      emailError,
      warning: emailSent
        ? undefined
        : 'Reservation cancelled, but cancellation email failed. Check Email Logs.'
    }
  } catch (err) {
    console.error('[v0] cancelReservation failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Failed to cancel reservation.' }
  }
}
