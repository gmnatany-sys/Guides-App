'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'
import { syncMinimumParticipantsForTourDate } from '@/app/admin/alerts/actions'
import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'

// Email body generator for cancellation emails
function getCancellationEmailBody(reservation: Record<string, unknown>, logoUrl?: string): { html: string, text: string } {
  const voucherNumber = reservation?.voucher_number || 'N/A'
  const reservationNumber = reservation?.reservation_number || 'N/A'
  const leadPassenger = reservation?.lead_passenger_name || 'N/A'
  const whatsapp = reservation?.whatsapp_number || 'N/A'
  const tourName = (reservation?.tours as Record<string, unknown>)?.name || 'N/A'
  const tourDate = reservation?.tour_dates 
    ? new Date((reservation.tour_dates as Record<string, unknown>).tour_date as string).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A'
  const participants = reservation?.participants || 'N/A'
  const cancelledAt = reservation?.cancelled_at 
    ? new Date(reservation.cancelled_at as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'N/A'
  const internalNotes = reservation?.internal_notes || 'None'
  const agentName = (reservation?.agent_name as string) || 'Not assigned'
  const agentEmail = (reservation?.agent_email as string) || 'Not assigned'

  const logoHeader = logoUrl ? `
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${logoUrl}" alt="Japan Tours" style="max-width: 180px; height: auto; display: block; margin: 0 auto;" />
    </div>
  ` : ''

  const containerStyle = `font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;`
  const headerStyle = `font-size: 24px; font-weight: bold; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #e5e7eb;`
  const tableStyle = `width: 100%; border-collapse: collapse; margin: 20px 0;`
  const thStyle = `text-align: left; padding: 10px 12px; background-color: #f3f4f6; border: 1px solid #e5e7eb; font-weight: 600; color: #374151; width: 40%;`
  const tdStyle = `padding: 10px 12px; border: 1px solid #e5e7eb; color: #1f2937;`
  const footerStyle = `margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;`

  return {
    html: `
      <div style="${containerStyle}">
        ${logoHeader}
        <h1 style="${headerStyle} color: #dc2626;">Tour Reservation Cancelled</h1>
        <p>Hello Itai,</p>
        <p>A tour reservation has been cancelled due to tour date cancellation from the Availability Calendar.</p>
        
        <table style="${tableStyle}">
          <tr><th style="${thStyle}">Voucher Number</th><td style="${tdStyle}">${voucherNumber}</td></tr>
          <tr><th style="${thStyle}">Reservation Number</th><td style="${tdStyle}">${reservationNumber}</td></tr>
          <tr><th style="${thStyle}">Lead Passenger Name</th><td style="${tdStyle}">${leadPassenger}</td></tr>
          <tr><th style="${thStyle}">WhatsApp Number</th><td style="${tdStyle}">${whatsapp}</td></tr>
          <tr><th style="${thStyle}">Tour</th><td style="${tdStyle}">${tourName}</td></tr>
          <tr><th style="${thStyle}">Tour Date</th><td style="${tdStyle}">${tourDate}</td></tr>
          <tr><th style="${thStyle}">Participants</th><td style="${tdStyle}">${participants}</td></tr>
          <tr><th style="${thStyle}">Status</th><td style="${tdStyle}"><span style="color: #dc2626; font-weight: bold;">CANCELLED</span></td></tr>
          <tr><th style="${thStyle}">Cancellation Date</th><td style="${tdStyle}">${cancelledAt}</td></tr>
          <tr><th style="${thStyle}">Agent Name</th><td style="${tdStyle}">${agentName}</td></tr>
          <tr><th style="${thStyle}">Agent Email</th><td style="${tdStyle}">${agentEmail}</td></tr>
          <tr><th style="${thStyle}">Internal Notes</th><td style="${tdStyle}">${internalNotes}</td></tr>
        </table>
        
        <div style="${footerStyle}">
          <p>This is an automated message from Japan Tours.</p>
        </div>
      </div>
    `,
    text: `TOUR RESERVATION CANCELLED

Hello Itai,

A tour reservation has been cancelled due to tour date cancellation from the Availability Calendar.

RESERVATION DETAILS
-------------------
Voucher Number: ${voucherNumber}
Reservation Number: ${reservationNumber}
Lead Passenger Name: ${leadPassenger}
WhatsApp Number: ${whatsapp}
Tour: ${tourName}
Tour Date: ${tourDate}
Participants: ${participants}
Status: CANCELLED
Cancellation Date: ${cancelledAt}
Agent Name: ${agentName}
Agent Email: ${agentEmail}
Internal Notes: ${internalNotes}

---
This is an automated message from Japan Tours.`
  }
}

export async function fetchToursAndDates() {
  const supabase = await createClient()
  
  const [toursResult, tourDatesResult] = await Promise.all([
    supabase.from('tours').select('*').order('name'),
    supabase.from('tour_dates').select('*, tours(name)').order('tour_date', { ascending: true })
  ])

  return {
    tours: toursResult.data || [],
    tourDates: tourDatesResult.data || [],
    error: toursResult.error?.message || tourDatesResult.error?.message || null
  }
}

export async function addOpenDate(formData: FormData) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'availability_calendar_manage_access')) {
    return { success: false, error: 'Access denied' }
  }
  const tourId = formData.get('tour_id') as string
  const tourDate = formData.get('tour_date') as string
  const isOpen = formData.get('is_open') === 'true'
  const supplierStatus = formData.get('supplier_status') as string
  const notes = formData.get('notes') as string

  const supabase = await createClient()
  
  const { error } = await supabase.from('tour_dates').insert({
    tour_id: tourId,
    tour_date: tourDate,
    is_open: isOpen,
    supplier_status: supplierStatus,
    notes: notes || null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin/open-dates')
  return { success: true }
}

export async function upsertOpenDate(formData: FormData) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'availability_calendar_manage_access')) {
    return { success: false, error: 'Access denied' }
  }
  const tourId = formData.get('tour_id') as string
  const tourDate = formData.get('tour_date') as string
  const isOpen = formData.get('is_open') === 'true'
  const supplierStatus = formData.get('supplier_status') as string
  const notes = formData.get('notes') as string

  const supabase = await createClient()
  
  // Check if record exists
  const { data: existing } = await supabase
    .from('tour_dates')
    .select('id')
    .eq('tour_id', tourId)
    .eq('tour_date', tourDate)
    .single()

  let error
  if (existing) {
    // Update existing record
    const { error: updateError } = await supabase
      .from('tour_dates')
      .update({
        is_open: isOpen,
        supplier_status: supplierStatus,
        notes: notes || null,
      })
      .eq('id', existing.id)
    error = updateError
  } else {
    // Insert new record
    const { error: insertError } = await supabase.from('tour_dates').insert({
      tour_id: tourId,
      tour_date: tourDate,
      is_open: isOpen,
      supplier_status: supplierStatus,
      notes: notes || null,
    })
    error = insertError
  }

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin/open-dates')
  return { success: true, isUpdate: !!existing }
}

// Fetch tour dates for a specific tour and month
export async function fetchTourDatesForMonth(tourId: string, year: number, month: number) {
  const supabase = await createClient()
  
  // First day of month
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  // Last day of month
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

// Bulk upsert dates - open selected dates
export async function bulkOpenDates(tourId: string, dates: string[]) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'availability_calendar_manage_access')) {
    return { success: false, error: 'Access denied', successCount: 0, errorCount: 0, message: 'Access denied' }
  }
  const supabase = await createClient()
  
  let successCount = 0
  let errorCount = 0
  const affectedIds: string[] = []
  
  for (const dateStr of dates) {
    // Check if record exists
    const { data: existing } = await supabase
      .from('tour_dates')
      .select('id, notes')
      .eq('tour_id', tourId)
      .eq('tour_date', dateStr)
      .single()
    
    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('tour_dates')
        .update({
          is_open: true,
          supplier_status: 'YES',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
      
      if (error) errorCount++
      else { successCount++; affectedIds.push(existing.id) }
    } else {
      // Insert new
      const { data: inserted, error } = await supabase
        .from('tour_dates')
        .insert({
          tour_id: tourId,
          tour_date: dateStr,
          is_open: true,
          supplier_status: 'YES'
        })
        .select('id')
        .single()
      
      if (error) errorCount++
      else { successCount++; if (inserted) affectedIds.push(inserted.id) }
    }
  }

  // Live minimum-participants sync for only the affected dates.
  for (const id of affectedIds) {
    try {
      await syncMinimumParticipantsForTourDate(id)
    } catch (err) {
      console.error('[v0] minimum-participants sync failed after opening date:', err)
    }
  }
  
  revalidatePath('/admin/open-dates')
  revalidatePath('/admin/open-dates/new')
  
  return { 
    success: errorCount === 0, 
    successCount, 
    errorCount,
    message: `${successCount} date(s) opened${errorCount > 0 ? `, ${errorCount} failed` : ''}.`
  }
}

// Bulk upsert dates - close selected dates
export async function bulkCloseDates(tourId: string, dates: string[]) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'availability_calendar_manage_access')) {
    return { success: false, error: 'Access denied', successCount: 0, errorCount: 0, message: 'Access denied' }
  }
  const supabase = await createClient()
  
  let successCount = 0
  let errorCount = 0
  const affectedIds: string[] = []
  
  for (const dateStr of dates) {
    // Check if record exists
    const { data: existing } = await supabase
      .from('tour_dates')
      .select('id, notes')
      .eq('tour_id', tourId)
      .eq('tour_date', dateStr)
      .single()
    
    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('tour_dates')
        .update({
          is_open: false,
          supplier_status: 'NO',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
      
      if (error) errorCount++
      else { successCount++; affectedIds.push(existing.id) }
    } else {
      // Insert new
      const { data: inserted, error } = await supabase
        .from('tour_dates')
        .insert({
          tour_id: tourId,
          tour_date: dateStr,
          is_open: false,
          supplier_status: 'NO'
        })
        .select('id')
        .single()
      
      if (error) errorCount++
      else { successCount++; if (inserted) affectedIds.push(inserted.id) }
    }
  }

  // Live minimum-participants sync for only the affected dates (closed -> resolve).
  for (const id of affectedIds) {
    try {
      await syncMinimumParticipantsForTourDate(id)
    } catch (err) {
      console.error('[v0] minimum-participants sync failed after closing date:', err)
    }
  }
  
  revalidatePath('/admin/open-dates')
  revalidatePath('/admin/open-dates/new')
  
  return { 
    success: errorCount === 0, 
    successCount, 
    errorCount,
    message: `${successCount} date(s) closed${errorCount > 0 ? `, ${errorCount} failed` : ''}.`
  }
}

// Cancel selected dates - sets is_open=false, supplier_status=CANCELLED, cancels reservations, sends emails immediately
export async function cancelSelectedDates(tourId: string, dates: string[]) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'availability_calendar_manage_access')) {
    return { success: false, error: 'Access denied', datesProcessed: 0, reservationsCancelled: 0, emailsSent: 0, emailsFailed: 0, errors: [], message: 'Access denied' }
  }
  const supabase = await createClient()
  
  // Initialize Resend for sending emails
  const resendApiKey = process.env.RESEND_API_KEY
  const resend = resendApiKey ? new Resend(resendApiKey) : null
  
  // Build logo URL for emails
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || ''
  const logoUrl = appUrl 
    ? (appUrl.startsWith('http') ? `${appUrl}/japan-tours-logo.png` : `https://${appUrl}/japan-tours-logo.png`)
    : ''
  
  let datesProcessed = 0
  let reservationsCancelled = 0
  let emailsSent = 0
  let emailsFailed = 0
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
      // Date not in DB means it's closed/doesn't exist, skip
      continue
    }

    if (!tourDate.is_open) {
      // Already closed, skip
      continue
    }

    // A. Update tour_dates
    const cancelNote = 'Cancelled from Availability Calendar.'
    const updatedNotes = tourDate.notes 
      ? `${tourDate.notes}\n${cancelNote}` 
      : cancelNote

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

    // B. Find all active reservations for this tour_date_id (only WAITING FOR CONFIRMATION and CONFIRMED)
    const { data: reservations } = await supabase
      .from('reservations')
      .select('id, voucher_number, reservation_number, internal_notes, agent_user_id, agent_name, agent_email')
      .eq('tour_date_id', tourDate.id)
      .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])

    if (!reservations || reservations.length === 0) {
      continue
    }

    // C & D. For each reservation, cancel it and send email immediately
    for (const reservation of reservations) {
      // Check if CANCELLED email log already exists with SENT status (prevent duplicates)
      const { data: existingLog } = await supabase
        .from('email_logs')
        .select('id')
        .eq('reservation_id', reservation.id)
        .eq('email_type', 'CANCELLED')
        .eq('status', 'SENT')
        .single()

      if (existingLog) {
        // Skip if already has a sent cancellation email
        continue
      }

      // Update reservation to CANCELLED
      const cancelReservationNote = 'Cancelled because the tour date was cancelled from Availability Calendar.'
      const updatedInternalNotes = reservation.internal_notes 
        ? `${reservation.internal_notes}\n${cancelReservationNote}` 
        : cancelReservationNote

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

      // Load full reservation details for email
      const { data: fullReservation } = await supabase
        .from('reservations')
        .select('*, tours(name), tour_dates(tour_date)')
        .eq('id', reservation.id)
        .single()

      // Create email log and send email immediately
      const voucherRef = reservation.voucher_number || reservation.reservation_number
      const emailSubject = `Tour Reservation Cancelled - Voucher #${voucherRef}`
      const fromEmail = 'info@yapantours.com'
      const toEmail = 'itai@mitiya.co'
      const ccEmails = ['reservation@yapantours.com', 'gmnatany@yapantours.com']

      // Generate email body
      const { html, text } = getCancellationEmailBody(fullReservation || reservation, logoUrl || undefined)

      // Try to send email via Resend
      let emailStatus = 'PENDING'
      let sentAt: string | null = null
      let errorMessage: string | null = null

      if (resend && resendApiKey) {
        try {
          const { error: sendError } = await resend.emails.send({
            from: fromEmail,
            to: toEmail,
            cc: ccEmails,
            subject: emailSubject,
            html: html,
            text: text
          })

          if (sendError) {
            emailStatus = 'FAILED'
            errorMessage = sendError.message
            emailsFailed++
          } else {
            emailStatus = 'SENT'
            sentAt = new Date().toISOString()
            emailsSent++
          }
        } catch (err) {
          emailStatus = 'FAILED'
          errorMessage = err instanceof Error ? err.message : 'Unknown error'
          emailsFailed++
        }
      } else {
        // No Resend API key, mark as PENDING for manual sending
        emailsFailed++
        errorMessage = 'RESEND_API_KEY not configured'
      }

      // Insert email log with result
      await supabase
        .from('email_logs')
        .insert({
          reservation_id: reservation.id,
          email_type: 'CANCELLED',
          from_email: fromEmail,
          to_email: toEmail,
          cc: ccEmails.join(','),
          subject: emailSubject,
          status: emailStatus,
          sent_at: sentAt,
          error_message: errorMessage
        })
    }
  }

  // Live minimum-participants sync for only the cancelled dates (resolve open alerts).
  for (const id of affectedIds) {
    try {
      await syncMinimumParticipantsForTourDate(id)
    } catch (err) {
      console.error('[v0] minimum-participants sync failed after cancelling date:', err)
    }
  }

  revalidatePath('/admin/open-dates')
  revalidatePath('/admin/open-dates/new')
  revalidatePath('/admin/reservations')
  revalidatePath('/admin/email-logs')

  const success = errors.length === 0
  let message = ''
  
  if (datesProcessed === 0 && reservationsCancelled === 0) {
    message = 'No dates were cancelled (all selected dates were already closed).'
  } else if (reservationsCancelled === 0) {
    message = `${datesProcessed} date(s) cancelled. No reservations affected.`
  } else if (emailsFailed === 0 && emailsSent > 0) {
    message = `Selected dates cancelled successfully. ${reservationsCancelled} reservation(s) cancelled. Cancellation emails sent.`
  } else if (emailsSent > 0 && emailsFailed > 0) {
    message = `Selected dates cancelled, but some cancellation emails failed. ${emailsSent} sent, ${emailsFailed} failed. Please check Email Logs.`
  } else if (emailsFailed > 0 && emailsSent === 0) {
    message = `Selected dates cancelled, but cancellation emails failed. Please check Email Logs.`
  } else {
    message = `${datesProcessed} date(s) cancelled, ${reservationsCancelled} reservation(s) cancelled.`
  }

  return {
    success,
    datesProcessed,
    reservationsCancelled,
    emailsSent,
    emailsFailed,
    errors,
    message
  }
}
