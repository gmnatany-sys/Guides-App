'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { syncMinimumParticipantsForTourDate } from '@/app/admin/alerts/actions'

export async function fetchTours() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('tours').select('*').order('name')
  return { tours: data || [], error: error?.message || null }
}

export async function fetchOpenTourDatesForMonth(tourId: string, year: number, month: number) {
  const supabase = await createClient()
  
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  
  const { data, error } = await supabase
    .from('tour_dates')
    .select('*')
    .eq('tour_id', tourId)
    .gte('tour_date', startDate)
    .lte('tour_date', endDate)
  
  if (error) {
    return { tourDates: [], error: error.message }
  }
  
  return { tourDates: data || [], error: null }
}

export async function fetchRecentlyCancelledDates(limit: number = 10) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('tour_dates')
    .select('*, tours(name)')
    .eq('supplier_status', 'CANCELLED')
    .order('updated_at', { ascending: false })
    .limit(limit)
  
  if (error) {
    return { cancelledDates: [], error: error.message }
  }

  // For each cancelled date, count how many reservations were cancelled
  const cancelledDatesWithCounts = await Promise.all(
    (data || []).map(async (tourDate) => {
      const { count } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('tour_date_id', tourDate.id)
        .eq('status', 'CANCELLED')
      
      return {
        ...tourDate,
        cancelled_reservations_count: count || 0
      }
    })
  )
  
  return { cancelledDates: cancelledDatesWithCounts, error: null }
}

export async function cancelSelectedDates(tourId: string, dates: string[], cancellationNotes: string) {
  const supabase = await createClient()
  
  let datesProcessed = 0
  let reservationsCancelled = 0
  let emailLogsCreated = 0
  const errors: string[] = []
  const affectedIds: string[] = []

  for (const dateStr of dates) {
    // Find the tour_date record
    const { data: tourDate } = await supabase
      .from('tour_dates')
      .select('id, notes, is_open')
      .eq('tour_id', tourId)
      .eq('tour_date', dateStr)
      .single()

    if (!tourDate) {
      errors.push(`Tour date ${dateStr} not found`)
      continue
    }

    if (!tourDate.is_open) {
      errors.push(`Tour date ${dateStr} is already closed`)
      continue
    }

    // A. Update tour_dates
    const notePrefix = 'Cancelled by supplier.'
    const fullNote = cancellationNotes 
      ? `${notePrefix} ${cancellationNotes}`
      : notePrefix
    const updatedNotes = tourDate.notes 
      ? `${tourDate.notes}\n${fullNote}` 
      : fullNote

    const { error: updateError } = await supabase
      .from('tour_dates')
      .update({
        is_open: false,
        supplier_status: 'CANCELLED',
        notes: updatedNotes,
        updated_at: new Date().toISOString()
      })
      .eq('id', tourDate.id)

    if (updateError) {
      errors.push(`Failed to update tour date ${dateStr}: ${updateError.message}`)
      continue
    }

    datesProcessed++
    affectedIds.push(tourDate.id)

    // B. Find all active reservations for this tour_date_id
    const { data: reservations } = await supabase
      .from('reservations')
      .select('id, voucher_number, reservation_number, internal_notes')
      .eq('tour_date_id', tourDate.id)
      .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])

    if (!reservations || reservations.length === 0) {
      continue
    }

    // C & D. For each reservation, cancel it and create email log
    for (const reservation of reservations) {
      // Check if email log already exists for this reservation
      const { data: existingLog } = await supabase
        .from('email_logs')
        .select('id')
        .eq('reservation_id', reservation.id)
        .eq('email_type', 'CANCELLED')
        .in('status', ['PENDING', 'SENT'])
        .single()

      if (existingLog) {
        // Skip if already has a pending or sent cancellation email
        continue
      }

      // Update reservation
      const cancelNote = cancellationNotes 
        ? `Cancelled because supplier cancelled the tour date. ${cancellationNotes}`
        : 'Cancelled because supplier cancelled the tour date.'
      const updatedInternalNotes = reservation.internal_notes 
        ? `${reservation.internal_notes}\n${cancelNote}` 
        : cancelNote

      const { error: reservationError } = await supabase
        .from('reservations')
        .update({
          status: 'CANCELLED',
          cancelled_at: new Date().toISOString(),
          internal_notes: updatedInternalNotes
        })
        .eq('id', reservation.id)

      if (reservationError) {
        errors.push(`Failed to cancel reservation ${reservation.reservation_number}: ${reservationError.message}`)
        continue
      }

      reservationsCancelled++

      // Create email log
      const voucherRef = reservation.voucher_number || reservation.reservation_number
      const { error: emailError } = await supabase
        .from('email_logs')
        .insert({
          reservation_id: reservation.id,
          email_type: 'CANCELLED',
          from_email: 'info@yapantours.com',
          to_email: 'itai@mitiya.co',
          cc: 'reservation@yapantours.com,gmnatany@yapantours.com',
          subject: `Tour Reservation Cancelled - Voucher #${voucherRef}`,
          status: 'PENDING'
        })

      if (!emailError) {
        emailLogsCreated++
      }
    }
  }

  // Live minimum-participants sync for only the cancelled dates (resolve open alerts).
  for (const id of affectedIds) {
    try {
      await syncMinimumParticipantsForTourDate(id)
    } catch (err) {
      console.error('[v0] minimum-participants sync failed after supplier cancel-dates:', err)
    }
  }

  revalidatePath('/supplier/cancel-dates')
  revalidatePath('/admin/open-dates')
  revalidatePath('/admin/reservations')
  revalidatePath('/admin/email-logs')

  const success = errors.length === 0
  let message = `${datesProcessed} date(s) cancelled`
  if (reservationsCancelled > 0) {
    message += `, ${reservationsCancelled} reservation(s) cancelled`
  }
  if (emailLogsCreated > 0) {
    message += `, ${emailLogsCreated} email(s) queued`
  }
  message += '.'

  return {
    success,
    datesProcessed,
    reservationsCancelled,
    emailLogsCreated,
    errors,
    message
  }
}
