'use server'

import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

type EmailType = 'NEW_BOOKING' | 'CONFIRMED' | 'NOT_CONFIRMED' | 'CANCELLED'

interface EmailLogParams {
  reservationId: string
  emailType: EmailType
  fromEmail: string
  toEmail: string
  cc?: string
  subject: string
  htmlBody?: string
  textBody?: string
}

function getEmailBody(
  emailType: EmailType, 
  subject: string, 
  reservation?: Record<string, unknown>, 
  logoUrl?: string
): { html: string, text: string } {
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
              <tr><th style="${thStyle}">Internal Notes</th><td style="${tdStyle}">${internalNotes}</td></tr>
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
Internal Notes: ${internalNotes}

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

export async function createEmailLog(params: EmailLogParams) {
  const supabase = await createClient()

  // First, create the email log with PENDING status
  const { data: emailLog, error: insertError } = await supabase.from('email_logs').insert({
    reservation_id: params.reservationId,
    email_type: params.emailType,
    from_email: params.fromEmail,
    to_email: params.toEmail,
    cc: params.cc || null,
    subject: params.subject,
    status: 'PENDING'
  }).select('id').single()

  if (insertError) {
    console.error('[v0] Failed to create email log:', insertError.message)
    return { success: false, error: insertError.message }
  }

  // Load full reservation details including tour name and tour date
  const { data: reservation, error: reservationError } = await supabase
    .from('reservations')
    .select('*, tours(name), tour_dates(tour_date)')
    .eq('id', params.reservationId)
    .single()

  if (reservationError) {
    console.error('[v0] Failed to load reservation:', reservationError.message)
  }

  // Build logo URL - requires full HTTPS URL for email clients
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || ''
  const logoUrl = appUrl 
    ? (appUrl.startsWith('http') ? `${appUrl}/japan-tours-logo.png` : `https://${appUrl}/japan-tours-logo.png`)
    : ''

  // Now send the actual email via Resend
  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    console.error('[v0] RESEND_API_KEY is not set')
    await supabase.from('email_logs').update({
      status: 'FAILED',
      error_message: 'RESEND_API_KEY is not configured'
    }).eq('id', emailLog.id)
    return { success: false, error: 'Email service not configured' }
  }

  const resend = new Resend(resendApiKey)
  
  // Generate email body with reservation details
  const { html, text } = params.htmlBody && params.textBody 
    ? { html: params.htmlBody, text: params.textBody }
    : getEmailBody(params.emailType, params.subject, reservation || undefined, logoUrl || undefined)

  // Parse CC emails into array
  const ccEmails = params.cc ? params.cc.split(',').map(e => e.trim()).filter(Boolean) : undefined

  try {
    // Timeout protection: never let the email send block the action indefinitely.
    const sendResult = await Promise.race([
      resend.emails.send({
        from: params.fromEmail,
        to: params.toEmail,
        cc: ccEmails,
        subject: params.subject,
        html: html,
        text: text
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Email send timed out after 10s')), 10000)
      )
    ]) as { error: { message: string } | null }

    const sendError = sendResult?.error

    if (sendError) {
      console.error('[v0] Failed to send email:', sendError.message)
      await supabase.from('email_logs').update({
        status: 'FAILED',
        error_message: sendError.message
      }).eq('id', emailLog.id)
      return { success: false, error: sendError.message }
    }

    // Update log to SENT
    await supabase.from('email_logs').update({
      status: 'SENT',
      sent_at: new Date().toISOString()
    }).eq('id', emailLog.id)

    return { success: true }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error sending email'
    console.error('[v0] Email send exception:', errorMessage)
    await supabase.from('email_logs').update({
      status: 'FAILED',
      error_message: errorMessage
    }).eq('id', emailLog.id)
    return { success: false, error: errorMessage }
  }
}
