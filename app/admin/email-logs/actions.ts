'use server'

import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import { createEmailLog } from '@/lib/email-log'
import type {
  CriticalEmailType,
  SafetyCheckResult,
  CreateMissingResult
} from './types'

// Sends an email via Resend with a hard timeout so a slow/unreachable provider
// can never make a "Send Pending" / "Retry" action hang indefinitely.
async function sendEmailWithTimeout(
  resend: Resend,
  payload: Parameters<Resend['emails']['send']>[0],
  timeoutMs = 10000
): Promise<{ error: { message: string } | null }> {
  try {
    const result = (await Promise.race([
      resend.emails.send(payload),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Email send timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      )
    ])) as { error: { message: string } | null }
    return { error: result?.error ?? null }
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'Email send failed' } }
  }
}

export async function fetchEmailLogs() {
  const t0 = Date.now()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('email_logs')
    .select('*, reservations(voucher_number, reservation_number)')
    .order('created_at', { ascending: false })
    .limit(50)

  console.log(`[v0] pageData route=/admin/email-logs step=fetchEmailLogs duration=${Date.now() - t0}ms`)

  if (error) {
    return { emailLogs: [], error: error.message }
  }

  return { emailLogs: data || [], error: null }
}

export async function getPendingEmailCount() {
  const t0 = Date.now()
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('email_logs')
    .select('*', { count: 'exact', head: true })
    .in('status', ['PENDING', 'READY_TO_SEND'])

  console.log(`[v0] pageData route=/admin/email-logs step=getPendingEmailCount duration=${Date.now() - t0}ms`)

  if (error) {
    return { count: 0, error: error.message }
  }

  return { count: count || 0, error: null }
}

function getEmailBody(emailType: string, subject: string, reservation?: Record<string, unknown>, logoUrl?: string): { html: string, text: string } {
  // Extract reservation details
  const voucherNumber = reservation?.voucher_number || 'N/A'
  const reservationNumber = reservation?.reservation_number || 'N/A'
  const leadPassenger = reservation?.lead_passenger_name || 'N/A'
  const whatsapp = reservation?.whatsapp_number || 'N/A'
  const tourName = (reservation?.tours as Record<string, unknown>)?.name || 'N/A'
  const tourDate = reservation?.tour_dates 
    ? new Date((reservation.tour_dates as Record<string, unknown>).tour_date as string).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A'
  const participants = reservation?.participants || 'N/A'
  const status = reservation?.status || 'N/A'
  const confirmationNumber = reservation?.confirmation_number || 'N/A'
  const cancelledAt = reservation?.cancelled_at 
    ? new Date(reservation.cancelled_at as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'N/A'
  const internalNotes = reservation?.internal_notes || 'None'
  const agentName = (reservation?.agent_name as string) || 'Not assigned'
  const agentEmail = (reservation?.agent_email as string) || 'Not assigned'

  // Logo header - only show if logoUrl is provided and valid
  const logoHeader = logoUrl ? `
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${logoUrl}" alt="Japan Tours" style="max-width: 180px; height: auto; display: block; margin: 0 auto;" />
    </div>
  ` : ''

  // Common styles
  const containerStyle = `font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;`
  const headerStyle = `font-size: 24px; font-weight: bold; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #e5e7eb;`
  const tableStyle = `width: 100%; border-collapse: collapse; margin: 20px 0;`
  const thStyle = `text-align: left; padding: 10px 12px; background-color: #f3f4f6; border: 1px solid #e5e7eb; font-weight: 600; color: #374151; width: 40%;`
  const tdStyle = `padding: 10px 12px; border: 1px solid #e5e7eb; color: #1f2937;`
  const footerStyle = `margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;`
  const linkStyle = `color: #2563eb; text-decoration: none;`
  const noteStyle = `background-color: #fef3c7; border: 1px solid #fcd34d; padding: 12px; border-radius: 6px; margin: 20px 0;`

  switch (emailType) {
    case 'NEW_BOOKING':
      return {
        html: `
          <div style="${containerStyle}">
            ${logoHeader}
            <h1 style="${headerStyle} color: #2563eb;">New Tour Reservation</h1>
            <p>Hello Itai,</p>
            <p>A new tour reservation has been submitted and is waiting for supplier confirmation.</p>
            
            <table style="${tableStyle}">
              <tr><th style="${thStyle}">Voucher Number</th><td style="${tdStyle}">${voucherNumber}</td></tr>
              <tr><th style="${thStyle}">Reservation Number</th><td style="${tdStyle}">${reservationNumber}</td></tr>
              <tr><th style="${thStyle}">Lead Passenger Name</th><td style="${tdStyle}">${leadPassenger}</td></tr>
              <tr><th style="${thStyle}">WhatsApp Number</th><td style="${tdStyle}">${whatsapp}</td></tr>
              <tr><th style="${thStyle}">Tour</th><td style="${tdStyle}">${tourName}</td></tr>
              <tr><th style="${thStyle}">Tour Date</th><td style="${tdStyle}">${tourDate}</td></tr>
              <tr><th style="${thStyle}">Participants</th><td style="${tdStyle}">${participants}</td></tr>
              <tr><th style="${thStyle}">Current Status</th><td style="${tdStyle}">${status}</td></tr>
              <tr><th style="${thStyle}">Agent Name</th><td style="${tdStyle}">${agentName}</td></tr>
              <tr><th style="${thStyle}">Agent Email</th><td style="${tdStyle}">${agentEmail}</td></tr>
            </table>
            
            <div style="${noteStyle}">
              <strong>Action Required:</strong> Please review and confirm this booking in the Supplier Confirmation Queue.
            </div>
            
            <p>Supplier Confirmation Queue: <a href="/supplier/confirm" style="${linkStyle}">/supplier/confirm</a></p>
            
            <div style="${footerStyle}">
              <p>This is an automated message from Japan Tours.</p>
            </div>
          </div>
        `,
        text: `NEW TOUR RESERVATION

Hello Itai,

A new tour reservation has been submitted and is waiting for supplier confirmation.

RESERVATION DETAILS
-------------------
Voucher Number: ${voucherNumber}
Reservation Number: ${reservationNumber}
Lead Passenger Name: ${leadPassenger}
WhatsApp Number: ${whatsapp}
Tour: ${tourName}
Tour Date: ${tourDate}
Participants: ${participants}
Current Status: ${status}
Agent Name: ${agentName}
Agent Email: ${agentEmail}

ACTION REQUIRED: Please review and confirm this booking in the Supplier Confirmation Queue.

Supplier Confirmation Queue: /supplier/confirm

---
This is an automated message from Japan Tours.`
      }

    case 'CONFIRMED':
      return {
        html: `
          <div style="${containerStyle}">
            ${logoHeader}
            <h1 style="${headerStyle} color: #16a34a;">Tour Reservation Confirmed</h1>
            <p>Great news! The tour reservation has been confirmed by the supplier.</p>
            
            <table style="${tableStyle}">
              <tr><th style="${thStyle}">Confirmation Number</th><td style="${tdStyle}"><strong style="color: #16a34a;">${confirmationNumber}</strong></td></tr>
              <tr><th style="${thStyle}">Voucher Number</th><td style="${tdStyle}">${voucherNumber}</td></tr>
              <tr><th style="${thStyle}">Reservation Number</th><td style="${tdStyle}">${reservationNumber}</td></tr>
              <tr><th style="${thStyle}">Lead Passenger Name</th><td style="${tdStyle}">${leadPassenger}</td></tr>
              <tr><th style="${thStyle}">WhatsApp Number</th><td style="${tdStyle}">${whatsapp}</td></tr>
              <tr><th style="${thStyle}">Tour</th><td style="${tdStyle}">${tourName}</td></tr>
              <tr><th style="${thStyle}">Tour Date</th><td style="${tdStyle}">${tourDate}</td></tr>
              <tr><th style="${thStyle}">Participants</th><td style="${tdStyle}">${participants}</td></tr>
              <tr><th style="${thStyle}">Status</th><td style="${tdStyle}"><span style="color: #16a34a; font-weight: bold;">CONFIRMED</span></td></tr>
              <tr><th style="${thStyle}">Agent Name</th><td style="${tdStyle}">${agentName}</td></tr>
              <tr><th style="${thStyle}">Agent Email</th><td style="${tdStyle}">${agentEmail}</td></tr>
            </table>
            
            <div style="${footerStyle}">
              <p>This is an automated message from Japan Tours.</p>
            </div>
          </div>
        `,
        text: `TOUR RESERVATION CONFIRMED

Great news! The tour reservation has been confirmed by the supplier.

RESERVATION DETAILS
-------------------
Confirmation Number: ${confirmationNumber}
Voucher Number: ${voucherNumber}
Reservation Number: ${reservationNumber}
Lead Passenger Name: ${leadPassenger}
WhatsApp Number: ${whatsapp}
Tour: ${tourName}
Tour Date: ${tourDate}
Participants: ${participants}
Status: CONFIRMED
Agent Name: ${agentName}
Agent Email: ${agentEmail}

---
This is an automated message from Japan Tours.`
      }

    case 'NOT_CONFIRMED':
      return {
        html: `
          <div style="${containerStyle}">
            ${logoHeader}
            <h1 style="${headerStyle} color: #ea580c;">Tour Reservation Not Confirmed</h1>
            <p>Unfortunately, the supplier did not confirm the following reservation.</p>
            
            <table style="${tableStyle}">
              <tr><th style="${thStyle}">Voucher Number</th><td style="${tdStyle}">${voucherNumber}</td></tr>
              <tr><th style="${thStyle}">Reservation Number</th><td style="${tdStyle}">${reservationNumber}</td></tr>
              <tr><th style="${thStyle}">Lead Passenger Name</th><td style="${tdStyle}">${leadPassenger}</td></tr>
              <tr><th style="${thStyle}">WhatsApp Number</th><td style="${tdStyle}">${whatsapp}</td></tr>
              <tr><th style="${thStyle}">Tour</th><td style="${tdStyle}">${tourName}</td></tr>
              <tr><th style="${thStyle}">Tour Date</th><td style="${tdStyle}">${tourDate}</td></tr>
              <tr><th style="${thStyle}">Participants</th><td style="${tdStyle}">${participants}</td></tr>
              <tr><th style="${thStyle}">Status</th><td style="${tdStyle}"><span style="color: #ea580c; font-weight: bold;">NOT CONFIRMED</span></td></tr>
              <tr><th style="${thStyle}">Agent Name</th><td style="${tdStyle}">${agentName}</td></tr>
              <tr><th style="${thStyle}">Agent Email</th><td style="${tdStyle}">${agentEmail}</td></tr>
            </table>
            
            <div style="${noteStyle}">
              <strong>Action Required:</strong> Please contact the customer to discuss alternative arrangements.
            </div>
            
            <div style="${footerStyle}">
              <p>This is an automated message from Japan Tours.</p>
            </div>
          </div>
        `,
        text: `TOUR RESERVATION NOT CONFIRMED

Unfortunately, the supplier did not confirm the following reservation.

RESERVATION DETAILS
-------------------
Voucher Number: ${voucherNumber}
Reservation Number: ${reservationNumber}
Lead Passenger Name: ${leadPassenger}
WhatsApp Number: ${whatsapp}
Tour: ${tourName}
Tour Date: ${tourDate}
Participants: ${participants}
Status: NOT CONFIRMED
Agent Name: ${agentName}
Agent Email: ${agentEmail}

ACTION REQUIRED: Please contact the customer to discuss alternative arrangements.

---
This is an automated message from Japan Tours.`
      }

    case 'CANCELLED':
      return {
        html: `
          <div style="${containerStyle}">
            ${logoHeader}
            <h1 style="${headerStyle} color: #dc2626;">Tour Reservation Cancelled</h1>
            <p>Hello Itai,</p>
            <p>A confirmed tour reservation has been cancelled.</p>
            
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

A confirmed tour reservation has been cancelled.

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

    default:
      return {
        html: `<div style="${containerStyle}"><p>${subject}</p></div>`,
        text: subject
      }
  }
}

// ---------------------------------------------------------------------------
// Email Safety Check
// Scans recent reservations and ensures every reservation has the critical
// email_logs it should have. Reuses the existing email pipeline / templates.
// ---------------------------------------------------------------------------

// Build the from/to/cc/subject for a given critical email type, matching the
// exact conventions used by the existing booking/supplier flows.
function buildEmailMeta(
  emailType: CriticalEmailType,
  reservation: Record<string, any>
): { fromEmail: string; toEmail: string; cc: string; subject: string } {
  const voucher = reservation?.voucher_number || reservation?.reservation_number
  const confirmationNumber = reservation?.confirmation_number || 'N/A'

  switch (emailType) {
    case 'NEW_BOOKING':
      return {
        fromEmail: 'reservation@yapantours.com',
        toEmail: 'itai@mitiya.co',
        cc: 'gmnatany@yapantours.com',
        subject: `New Tour Reservation - Voucher #${voucher}`
      }
    case 'CONFIRMED':
      return {
        fromEmail: 'info@yapantours.com',
        toEmail: 'reservation@yapantours.com',
        cc: 'gmnatany@yapantours.com,itai@mitiya.co',
        subject: `Tour Reservation Confirmed - Confirmation #${confirmationNumber}`
      }
    case 'NOT_CONFIRMED':
      return {
        fromEmail: 'info@yapantours.com',
        toEmail: 'reservation@yapantours.com',
        cc: 'gmnatany@yapantours.com',
        subject: `Tour Reservation Not Confirmed - Voucher #${voucher}`
      }
    case 'CANCELLED':
      return {
        fromEmail: 'info@yapantours.com',
        toEmail: 'itai@mitiya.co',
        cc: 'reservation@yapantours.com,gmnatany@yapantours.com',
        subject: `Tour Reservation Cancelled - Voucher #${voucher}`
      }
  }
}

// Determine which critical email types a reservation should have, based on its status.
function getRequiredEmailTypes(reservationStatus: string): CriticalEmailType[] {
  const required: CriticalEmailType[] = ['NEW_BOOKING']
  if (reservationStatus === 'CONFIRMED') required.push('CONFIRMED')
  if (reservationStatus === 'NOT CONFIRMED') required.push('NOT_CONFIRMED')
  if (reservationStatus === 'CANCELLED') required.push('CANCELLED')
  return required
}

// Scan reservations from the last 30 days for missing critical emails.
export async function checkMissingCriticalEmails(): Promise<SafetyCheckResult> {
  const supabase = await createClient()

  const empty: SafetyCheckResult = {
    success: true,
    counts: {
      missingNewBooking: 0,
      missingConfirmed: 0,
      missingNotConfirmed: 0,
      missingCancelled: 0,
      errorEmails: 0,
      pendingEmails: 0
    },
    missing: []
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Recent reservations
  const { data: reservations, error: resError } = await supabase
    .from('reservations')
    .select('id, voucher_number, reservation_number, lead_passenger_name, status, confirmation_number, created_at')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })

  if (resError) {
    return { ...empty, success: false, error: resError.message }
  }

  if (!reservations || reservations.length === 0) {
    return empty
  }

  const reservationIds = reservations.map((r) => r.id)

  // All email logs for those reservations
  const { data: logs, error: logsError } = await supabase
    .from('email_logs')
    .select('reservation_id, email_type, status')
    .in('reservation_id', reservationIds)

  if (logsError) {
    return { ...empty, success: false, error: logsError.message }
  }

  // Index logs by reservation_id -> email_type -> set of statuses
  const logIndex = new Map<string, Map<string, Set<string>>>()
  let errorEmails = 0
  let pendingEmails = 0

  for (const log of logs || []) {
    if (!log.reservation_id) continue
    if (log.status === 'FAILED') errorEmails++
    if (log.status === 'PENDING' || log.status === 'READY_TO_SEND') pendingEmails++

    if (!logIndex.has(log.reservation_id)) {
      logIndex.set(log.reservation_id, new Map())
    }
    const typeMap = logIndex.get(log.reservation_id)!
    if (!typeMap.has(log.email_type)) {
      typeMap.set(log.email_type, new Set())
    }
    typeMap.get(log.email_type)!.add(log.status)
  }

  const result: SafetyCheckResult = {
    success: true,
    counts: {
      missingNewBooking: 0,
      missingConfirmed: 0,
      missingNotConfirmed: 0,
      missingCancelled: 0,
      errorEmails,
      pendingEmails
    },
    missing: []
  }

  for (const reservation of reservations) {
    const requiredTypes = getRequiredEmailTypes(reservation.status)
    const typeMap = logIndex.get(reservation.id)

    for (const emailType of requiredTypes) {
      const statuses = typeMap?.get(emailType)
      // "Covered" = a SENT or FAILED (ERROR) email already exists for this type.
      const covered = statuses && (statuses.has('SENT') || statuses.has('FAILED'))
      if (covered) continue

      result.missing.push({
        reservationId: reservation.id,
        voucherNumber: reservation.voucher_number || '-',
        docketNumber: reservation.reservation_number || '-',
        leadPassengerName: reservation.lead_passenger_name || '-',
        missingEmailType: emailType,
        reservationStatus: reservation.status
      })

      if (emailType === 'NEW_BOOKING') result.counts.missingNewBooking++
      else if (emailType === 'CONFIRMED') result.counts.missingConfirmed++
      else if (emailType === 'NOT_CONFIRMED') result.counts.missingNotConfirmed++
      else if (emailType === 'CANCELLED') result.counts.missingCancelled++
    }
  }

  return result
}

// Create & send only the missing required emails, avoiding duplicates.
export async function createAndSendMissingEmails(): Promise<CreateMissingResult> {
  const supabase = await createClient()

  const result: CreateMissingResult = {
    success: true,
    created: 0,
    sentPending: 0,
    retriedFailed: 0,
    failed: 0,
    skipped: 0,
    details: []
  }

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    return { ...result, success: false, error: 'RESEND_API_KEY is not configured' }
  }
  const resend = new Resend(resendApiKey)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || ''
  const logoUrl = appUrl
    ? (appUrl.startsWith('http') ? `${appUrl}/japan-tours-logo.png` : `https://${appUrl}/japan-tours-logo.png`)
    : ''

  // Reuse the same scan to find what's required/missing.
  const check = await checkMissingCriticalEmails()
  if (!check.success) {
    return { ...result, success: false, error: check.error }
  }

  // Helper: send an existing email_log row (PENDING or FAILED retry) via Resend.
  async function sendExistingLog(logId: string, emailType: string, reservationId: string | null) {
    let reservation: Record<string, unknown> | null = null
    if (reservationId) {
      const { data } = await supabase
        .from('reservations')
        .select('*, tours(name), tour_dates(tour_date)')
        .eq('id', reservationId)
        .single()
      reservation = data
    }

    const { data: logRow } = await supabase
      .from('email_logs')
      .select('from_email, to_email, cc, subject')
      .eq('id', logId)
      .single()

    if (!logRow) return false

    const { html, text } = getEmailBody(emailType, logRow.subject, reservation || undefined, logoUrl || undefined)
    const ccEmails = logRow.cc ? logRow.cc.split(',').map((e: string) => e.trim()).filter(Boolean) : undefined

    try {
      const { error: sendError } = await sendEmailWithTimeout(resend, {
        from: logRow.from_email,
        to: logRow.to_email,
        cc: ccEmails,
        subject: logRow.subject,
        html,
        text
      })
      if (sendError) {
        await supabase.from('email_logs').update({ status: 'FAILED', error_message: sendError.message }).eq('id', logId)
        return false
      }
      await supabase.from('email_logs').update({ status: 'SENT', sent_at: new Date().toISOString(), error_message: null }).eq('id', logId)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      await supabase.from('email_logs').update({ status: 'FAILED', error_message: msg }).eq('id', logId)
      return false
    }
  }

  for (const item of check.missing) {
    const reservationId = item.reservationId
    const emailType = item.missingEmailType
    const label = `${item.voucherNumber} (${emailType})`

    // Re-read existing logs for this reservation + type to apply dedup rules.
    const { data: existingLogs } = await supabase
      .from('email_logs')
      .select('id, status')
      .eq('reservation_id', reservationId)
      .eq('email_type', emailType)

    const sentLog = existingLogs?.find((l) => l.status === 'SENT')
    if (sentLog) {
      // Already sent - never duplicate.
      result.skipped++
      result.details.push(`Skipped (already SENT): ${label}`)
      continue
    }

    const pendingLog = existingLogs?.find((l) => l.status === 'PENDING' || l.status === 'READY_TO_SEND')
    if (pendingLog) {
      // Send the existing PENDING row instead of creating a duplicate.
      const ok = await sendExistingLog(pendingLog.id, emailType, reservationId)
      if (ok) {
        result.sentPending++
        result.details.push(`Sent existing PENDING: ${label}`)
      } else {
        result.failed++
        result.details.push(`Failed sending PENDING: ${label}`)
      }
      continue
    }

    const failedLog = existingLogs?.find((l) => l.status === 'FAILED')
    if (failedLog) {
      // Retry the existing FAILED row.
      const ok = await sendExistingLog(failedLog.id, emailType, reservationId)
      if (ok) {
        result.retriedFailed++
        result.details.push(`Retried FAILED: ${label}`)
      } else {
        result.failed++
        result.details.push(`Retry failed: ${label}`)
      }
      continue
    }

    // No log exists - create & send a new one via the existing pipeline.
    const { data: reservation } = await supabase
      .from('reservations')
      .select('voucher_number, reservation_number, confirmation_number')
      .eq('id', reservationId)
      .single()

    const meta = buildEmailMeta(emailType, reservation || {})
    const sendResult = await createEmailLog({
      reservationId,
      emailType,
      fromEmail: meta.fromEmail,
      toEmail: meta.toEmail,
      cc: meta.cc,
      subject: meta.subject
    })

    if (sendResult.success) {
      result.created++
      result.details.push(`Created & sent: ${label}`)
    } else {
      result.failed++
      result.details.push(`Failed creating: ${label}`)
    }
  }

  return result
}

export async function sendPendingEmailLogs(testMode: boolean = false) {
  const supabase = await createClient()

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    return { success: false, error: 'RESEND_API_KEY is not configured', sent: 0, failed: 0 }
  }

  // Build logo URL - requires full HTTPS URL for email clients
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || ''
  const logoUrl = appUrl 
    ? (appUrl.startsWith('http') ? `${appUrl}/japan-tours-logo.png` : `https://${appUrl}/japan-tours-logo.png`)
    : ''

  const resend = new Resend(resendApiKey)

  // Fetch pending email logs
  let query = supabase
    .from('email_logs')
    .select('*')
    .in('status', ['PENDING', 'READY_TO_SEND'])
    .order('created_at', { ascending: true })

  if (testMode) {
    query = query.limit(1)
  }

  const { data: pendingLogs, error: fetchError } = await query

  if (fetchError) {
    return { success: false, error: fetchError.message, sent: 0, failed: 0 }
  }

  if (!pendingLogs || pendingLogs.length === 0) {
    return { success: true, error: null, sent: 0, failed: 0, message: 'No pending emails to send.' }
  }

  let sent = 0
  let failed = 0

  for (const emailLog of pendingLogs) {
    // Load reservation details if reservation_id exists
    let reservation: Record<string, unknown> | null = null
    if (emailLog.reservation_id) {
      const { data: resData } = await supabase
        .from('reservations')
        .select('*, tours(name), tour_dates(tour_date)')
        .eq('id', emailLog.reservation_id)
        .single()
      reservation = resData
    }

    // Generate email body with logo URL
    const { html, text } = getEmailBody(emailLog.email_type, emailLog.subject, reservation || undefined, logoUrl || undefined)

    // Parse CC emails into array
    const ccEmails = emailLog.cc ? emailLog.cc.split(',').map((e: string) => e.trim()).filter(Boolean) : undefined

    try {
      const { error: sendError } = await sendEmailWithTimeout(resend, {
        from: emailLog.from_email,
        to: emailLog.to_email,
        cc: ccEmails,
        subject: emailLog.subject,
        html: html,
        text: text
      })

      if (sendError) {
        await supabase.from('email_logs').update({
          status: 'FAILED',
          error_message: sendError.message
        }).eq('id', emailLog.id)
        failed++
      } else {
        await supabase.from('email_logs').update({
          status: 'SENT',
          sent_at: new Date().toISOString(),
          error_message: null
        }).eq('id', emailLog.id)
        sent++
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      await supabase.from('email_logs').update({
        status: 'FAILED',
        error_message: errorMessage
      }).eq('id', emailLog.id)
      failed++
    }
  }

  return { 
    success: true, 
    error: null, 
    sent, 
    failed, 
    message: `Processed ${sent + failed} email(s): ${sent} sent, ${failed} failed.` 
  }
}

// Retry all FAILED email logs by re-sending them via Resend.
export async function retryFailedEmails() {
  const supabase = await createClient()

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    return { success: false, error: 'RESEND_API_KEY is not configured', sent: 0, failed: 0 }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || ''
  const logoUrl = appUrl
    ? (appUrl.startsWith('http') ? `${appUrl}/japan-tours-logo.png` : `https://${appUrl}/japan-tours-logo.png`)
    : ''

  const resend = new Resend(resendApiKey)

  const { data: failedLogs, error: fetchError } = await supabase
    .from('email_logs')
    .select('*')
    .eq('status', 'FAILED')
    .order('created_at', { ascending: true })

  if (fetchError) {
    return { success: false, error: fetchError.message, sent: 0, failed: 0 }
  }

  if (!failedLogs || failedLogs.length === 0) {
    return { success: true, error: null, sent: 0, failed: 0, message: 'No failed emails to retry.' }
  }

  let sent = 0
  let failed = 0

  for (const emailLog of failedLogs) {
    let reservation: Record<string, unknown> | null = null
    if (emailLog.reservation_id) {
      const { data: resData } = await supabase
        .from('reservations')
        .select('*, tours(name), tour_dates(tour_date)')
        .eq('id', emailLog.reservation_id)
        .single()
      reservation = resData
    }

    const { html, text } = getEmailBody(emailLog.email_type, emailLog.subject, reservation || undefined, logoUrl || undefined)
    const ccEmails = emailLog.cc ? emailLog.cc.split(',').map((e: string) => e.trim()).filter(Boolean) : undefined

    try {
      const { error: sendError } = await sendEmailWithTimeout(resend, {
        from: emailLog.from_email,
        to: emailLog.to_email,
        cc: ccEmails,
        subject: emailLog.subject,
        html,
        text
      })

      if (sendError) {
        await supabase.from('email_logs').update({ status: 'FAILED', error_message: sendError.message }).eq('id', emailLog.id)
        failed++
      } else {
        await supabase.from('email_logs').update({ status: 'SENT', sent_at: new Date().toISOString(), error_message: null }).eq('id', emailLog.id)
        sent++
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      await supabase.from('email_logs').update({ status: 'FAILED', error_message: errorMessage }).eq('id', emailLog.id)
      failed++
    }
  }

  return {
    success: true,
    error: null,
    sent,
    failed,
    message: `Retried ${sent + failed} failed email(s): ${sent} sent, ${failed} still failing.`
  }
}
