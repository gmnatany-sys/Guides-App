'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createEmailLog } from '@/lib/email-log'
import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'

const MIN_PARTICIPANTS_CANCEL_MESSAGE = 'The tour was cancelled because the minimum number of participants was not reached.'

// Build the CANCELLED email body for a minimum-participants cancellation.
// Uses the same full reservation details table layout as the existing CANCELLED email,
// but with the minimum-participants cancellation message.
function buildMinParticipantsCancellationEmail(reservation: Record<string, any>): { html: string; text: string } {
  const voucherNumber = reservation?.voucher_number || 'N/A'
  const docketNumber = reservation?.reservation_number || 'N/A'
  const leadPassenger = reservation?.lead_passenger_name || 'N/A'
  const whatsapp = reservation?.whatsapp_number || 'N/A'
  const tourName = (reservation?.tours as Record<string, unknown>)?.name || 'N/A'
  const tourDate = reservation?.tour_dates
    ? new Date((reservation.tour_dates as Record<string, unknown>).tour_date as string).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'N/A'
  const participants = reservation?.participants ?? 'N/A'
  const status = reservation?.status || 'CANCELLED'
  const cancelledAt = reservation?.cancelled_at
    ? new Date(reservation.cancelled_at as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'N/A'
  const internalNotes = reservation?.internal_notes || 'None'
  const agentName = (reservation?.agent_name as string) || 'Not assigned'
  const agentEmail = (reservation?.agent_email as string) || 'Not assigned'

  const containerStyle = `font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;`
  const headerStyle = `font-size: 24px; font-weight: bold; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #e5e7eb;`
  const tableStyle = `width: 100%; border-collapse: collapse; margin: 20px 0;`
  const thStyle = `text-align: left; padding: 10px 12px; background-color: #f3f4f6; border: 1px solid #e5e7eb; font-weight: 600; color: #374151; width: 40%;`
  const tdStyle = `padding: 10px 12px; border: 1px solid #e5e7eb; color: #1f2937;`
  const footerStyle = `margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;`
  const noteStyle = `background-color: #fee2e2; border: 1px solid #fca5a5; padding: 12px; border-radius: 6px; margin: 20px 0; color: #991b1b;`

  const html = `
    <div style="${containerStyle}">
      <h1 style="${headerStyle} color: #dc2626;">Tour Reservation Cancelled</h1>
      <p>Hello,</p>
      <div style="${noteStyle}"><strong>${MIN_PARTICIPANTS_CANCEL_MESSAGE}</strong></div>

      <table style="${tableStyle}">
        <tr><th style="${thStyle}">Voucher Number</th><td style="${tdStyle}">${voucherNumber}</td></tr>
        <tr><th style="${thStyle}">Docket Number</th><td style="${tdStyle}">${docketNumber}</td></tr>
        <tr><th style="${thStyle}">Lead Passenger Name</th><td style="${tdStyle}">${leadPassenger}</td></tr>
        <tr><th style="${thStyle}">WhatsApp Number</th><td style="${tdStyle}">${whatsapp}</td></tr>
        <tr><th style="${thStyle}">Tour</th><td style="${tdStyle}">${tourName}</td></tr>
        <tr><th style="${thStyle}">Tour Date</th><td style="${tdStyle}">${tourDate}</td></tr>
        <tr><th style="${thStyle}">Participants</th><td style="${tdStyle}">${participants}</td></tr>
        <tr><th style="${thStyle}">Status</th><td style="${tdStyle}"><span style="color: #dc2626; font-weight: bold;">${status}</span></td></tr>
        <tr><th style="${thStyle}">Cancellation Date</th><td style="${tdStyle}">${cancelledAt}</td></tr>
        <tr><th style="${thStyle}">Agent Name</th><td style="${tdStyle}">${agentName}</td></tr>
        <tr><th style="${thStyle}">Agent Email</th><td style="${tdStyle}">${agentEmail}</td></tr>
        <tr><th style="${thStyle}">Internal Notes</th><td style="${tdStyle}">${internalNotes}</td></tr>
      </table>

      <div style="${footerStyle}">
        <p>This is an automated message from Japan Tours.</p>
      </div>
    </div>
  `

  const text = `TOUR RESERVATION CANCELLED

${MIN_PARTICIPANTS_CANCEL_MESSAGE}

RESERVATION DETAILS
-------------------
Voucher Number: ${voucherNumber}
Docket Number: ${docketNumber}
Lead Passenger Name: ${leadPassenger}
WhatsApp Number: ${whatsapp}
Tour: ${tourName}
Tour Date: ${tourDate}
Participants: ${participants}
Status: ${status}
Cancellation Date: ${cancelledAt}
Agent Name: ${agentName}
Agent Email: ${agentEmail}
Internal Notes: ${internalNotes}

---
This is an automated message from Japan Tours.`

  return { html, text }
}

// Email configuration
const EMAIL_CONFIG = {
  from: 'info@yapantours.com',
  operations: 'gmnatany@yapantours.com',
  supplier: 'itai@mitiya.co',
  cc_default: 'reservation@yapantours.com,itai@mitiya.co',
  cc_supplier: 'gmnatany@yapantours.com,reservation@yapantours.com'
}

export interface MinimumParticipantAlert {
  id: string
  tour_date_id: string
  alert_stage: 'LOW_PARTICIPANTS_7_DAYS' | 'LOW_PARTICIPANTS_5_DAYS' | 'SUPPLIER_DECISION_REQUIRED_3_DAYS'
  active_participants: number
  minimum_required: number
  days_before_tour: number
  // 'NOT CREATED' is a virtual status used for LIVE issues calculated from
  // tour_dates + reservations that do not yet have a row in minimum_participant_alerts.
  status: 'OPEN' | 'RESOLVED' | 'CANCELLED' | 'KEPT' | 'NOT CREATED'
  supplier_decision: 'KEEP_TOUR' | 'CANCEL_TOUR' | null
  // True when this record is backed by a real minimum_participant_alerts row.
  alert_exists?: boolean
  supplier_decision_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  tour_date?: {
    id: string
    tour_date: string
    tour?: {
      id: string
      name: string
    }
  }
}

export interface CheckResult {
  success: boolean
  error?: string
  alertsCreated: number
  alertsSkipped: number
  emailLogsCreated: number
  emailLogsSkipped: number
  details: string[]
}

// Per-reservation result row for a minimum-participants cancellation.
export interface CancellationEmailDetail {
  reservation_id: string
  voucher_number: string
  previous_status: string
  new_status: string
  agent_email: string | null
  email_log_created: boolean
  email_sent: boolean
  skipped_duplicate: boolean
  error: string | null
}

// Full summary returned to the UI for a minimum-participants cancellation.
export interface CancellationResult {
  success: boolean
  error?: string
  message?: string
  allProcessed: boolean
  activeReservationsFound: number
  reservationsCancelled: number
  emailLogsCreated: number
  emailsSent: number
  emailsSkippedDuplicate: number
  emailsFailed: number
  details: CancellationEmailDetail[]
}

// Small delay helper used to pace Resend sends (Resend rate-limits at ~2 req/sec;
// sending in a tight loop is what was causing some cancellation emails to silently
// fail with a 429 and never reach the customer).
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Send ONE cancellation email for a single reservation with strict per-reservation
// duplicate prevention and transient-failure retry. Returns a detail row describing
// exactly what happened so the UI can show a per-reservation breakdown.
//
// Duplicate rule (intentionally narrow): skip ONLY if a SENT CANCELLED email already
// exists for THIS reservation_id. A SENT email for a different reservation/voucher
// never blocks this one. PENDING/FAILED rows do NOT block a retry.
async function sendCancellationEmailForReservation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reservation: {
    id: string
    reservation_number?: string | null
    voucher_number?: string | null
    lead_passenger_name?: string | null
    whatsapp_number?: string | null
    participants?: number | null
    internal_notes?: string | null
    agent_name?: string | null
    agent_email?: string | null
    status?: string | null
    cancelled_at?: string | null
  },
  tourInfo: { name?: string | null; tour_date?: string | null },
  nowIso: string,
  previousStatus: string
): Promise<CancellationEmailDetail> {
  const detail: CancellationEmailDetail = {
    reservation_id: reservation.id,
    voucher_number: reservation.voucher_number || 'N/A',
    previous_status: previousStatus,
    new_status: 'CANCELLED',
    agent_email: reservation.agent_email || null,
    email_log_created: false,
    email_sent: false,
    skipped_duplicate: false,
    error: null
  }

  // Strict duplicate check: same reservation_id + CANCELLED + SENT only.
  const { data: existingSent, error: dupError } = await supabase
    .from('email_logs')
    .select('id')
    .eq('reservation_id', reservation.id)
    .eq('email_type', 'CANCELLED')
    .eq('status', 'SENT')
    .limit(1)

  if (dupError) {
    detail.error = `Duplicate check failed: ${dupError.message}`
    return detail
  }

  if (existingSent && existingSent.length > 0) {
    detail.skipped_duplicate = true
    return detail
  }

  // CC list: operations + supplier + agent (if present).
  const ccList = [EMAIL_CONFIG.operations, EMAIL_CONFIG.supplier]
  if (reservation.agent_email) {
    ccList.push(reservation.agent_email)
  }

  const emailBody = buildMinParticipantsCancellationEmail({
    voucher_number: reservation.voucher_number,
    reservation_number: reservation.reservation_number,
    lead_passenger_name: reservation.lead_passenger_name,
    whatsapp_number: reservation.whatsapp_number,
    participants: reservation.participants,
    status: 'CANCELLED',
    cancelled_at: reservation.cancelled_at || nowIso,
    internal_notes: reservation.internal_notes,
    agent_name: reservation.agent_name,
    agent_email: reservation.agent_email,
    tours: { name: tourInfo?.name },
    tour_dates: { tour_date: tourInfo?.tour_date }
  })

  // Send with up to 2 retries on transient failure. createEmailLog inserts the
  // log row (so email_log_created becomes true once we attempt) and updates its
  // status to SENT or FAILED.
  let lastError: string | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const sendResult = await createEmailLog({
      reservationId: reservation.id,
      emailType: 'CANCELLED',
      fromEmail: EMAIL_CONFIG.from,
      toEmail: 'reservation@yapantours.com',
      cc: ccList.join(','),
      subject: `Tour Reservation Cancelled - Minimum Participants Not Reached - Voucher #${reservation.voucher_number || 'N/A'}`,
      htmlBody: emailBody.html,
      textBody: emailBody.text
    })
    detail.email_log_created = true

    if (sendResult.success) {
      detail.email_sent = true
      detail.error = null
      return detail
    }

    lastError = sendResult.error || 'Unknown send error'
    // Back off before retrying to clear Resend rate limits.
    if (attempt < 3) {
      await sleep(800 * attempt)
    }
  }

  detail.error = lastError
  return detail
}

// Helper to check for duplicate email logs using email_type + to_email + subject
async function emailLogExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  emailType: string,
  toEmail: string,
  subject: string
): Promise<boolean> {
  const { data } = await supabase
    .from('email_logs')
    .select('id')
    .eq('email_type', emailType)
    .eq('to_email', toEmail)
    .eq('subject', subject)
    .in('status', ['PENDING', 'READY_TO_SEND', 'SENT'])
    .limit(1)
  
  return !!(data && data.length > 0)
}

// Helper to create a PENDING email log
async function createPendingEmailLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    reservationId?: string | null
    emailType: string
    fromEmail: string
    toEmail: string
    cc?: string
    subject: string
  }
): Promise<{ success: boolean; skipped?: boolean }> {
  // Check for duplicates using email_type + to_email + subject
  const exists = await emailLogExists(supabase, params.emailType, params.toEmail, params.subject)
  if (exists) {
    return { success: true, skipped: true }
  }
  
  const { error } = await supabase.from('email_logs').insert({
    reservation_id: params.reservationId || null,
    email_type: params.emailType,
    from_email: params.fromEmail,
    to_email: params.toEmail,
    cc: params.cc || null,
    subject: params.subject,
    status: 'PENDING'
  })
  
  if (error) {
    console.error('[v0] Failed to create email log:', error.message)
    return { success: false }
  }
  
  return { success: true, skipped: false }
}

// Active participants = SUM of reservations.participants for the same tour_date_id
// where status is WAITING FOR CONFIRMATION or CONFIRMED. Excludes CANCELLED / NOT CONFIRMED.
async function getActiveParticipants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tourDateId: string
): Promise<number> {
  const { data } = await supabase
    .from('reservations')
    .select('participants')
    .eq('tour_date_id', tourDateId)
    .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])
  return (data || []).reduce((sum, r) => sum + (r.participants || 0), 0)
}

// Safe create-or-update for a minimum_participant_alerts row keyed by the unique
// constraint (tour_date_id + alert_stage). This prevents duplicate-key errors when a
// row already exists for the same stage. If a row exists, it is updated in place;
// existing supplier_decision / supplier_decision_at are preserved (a decision is only
// recorded via resolveAlert). Returns the row id, or null on a hard failure.
async function upsertAlertRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    tourDateId: string
    alertStage: string
    activeParticipants: number
    minimumRequired: number
    daysBeforeTour: number
    status?: string
    nowIso?: string
  }
): Promise<{ id: string | null; created: boolean; error: string | null }> {
  const nowIso = params.nowIso || new Date().toISOString()

  // Find by the unique key first.
  const { data: existing } = await supabase
    .from('minimum_participant_alerts')
    .select('id, status')
    .eq('tour_date_id', params.tourDateId)
    .eq('alert_stage', params.alertStage)
    .maybeSingle()

  if (existing) {
    const update: Record<string, unknown> = {
      active_participants: params.activeParticipants,
      days_before_tour: params.daysBeforeTour,
      updated_at: nowIso,
    }
    // Only move status when a target status is provided AND it is appropriate to do
    // so (never override a decided KEPT/CANCELLED row here).
    if (
      params.status &&
      existing.status !== 'KEPT' &&
      existing.status !== 'CANCELLED'
    ) {
      update.status = params.status
    }
    const { error: updateError } = await supabase
      .from('minimum_participant_alerts')
      .update(update)
      .eq('id', existing.id)
    if (updateError) return { id: existing.id, created: false, error: updateError.message }
    return { id: existing.id, created: false, error: null }
  }

  // No row for this stage -> insert a fresh one.
  const { data: inserted, error: insertError } = await supabase
    .from('minimum_participant_alerts')
    .insert({
      tour_date_id: params.tourDateId,
      alert_stage: params.alertStage,
      active_participants: params.activeParticipants,
      minimum_required: params.minimumRequired,
      days_before_tour: params.daysBeforeTour,
      status: params.status || 'OPEN',
    })
    .select('id')
    .maybeSingle()

  // Handle a race where another sync inserted the same key between our check and
  // insert: fall back to updating the now-existing row instead of erroring.
  if (insertError) {
    const isDuplicate =
      insertError.code === '23505' ||
      /duplicate key|unique constraint/i.test(insertError.message || '')
    if (isDuplicate) {
      const { data: raced } = await supabase
        .from('minimum_participant_alerts')
        .select('id')
        .eq('tour_date_id', params.tourDateId)
        .eq('alert_stage', params.alertStage)
        .maybeSingle()
      if (raced) {
        await supabase
          .from('minimum_participant_alerts')
          .update({
            active_participants: params.activeParticipants,
            days_before_tour: params.daysBeforeTour,
            updated_at: nowIso,
          })
          .eq('id', raced.id)
        return { id: raced.id, created: false, error: null }
      }
    }
    return { id: null, created: false, error: insertError.message }
  }

  return { id: inserted?.id || null, created: true, error: null }
}

// Batched version: SUM of active participants for many tour dates at once.
async function getActiveParticipantsMap(
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

// Latest active-reservation creation time per tour date. Used to detect whether a
// tour date has received fresh bookings AFTER a supplier decision was recorded — in
// which case the decision is stale and the date must resurface as a live issue.
async function getLatestActiveReservationMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tourDateIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (tourDateIds.length === 0) return map
  const { data } = await supabase
    .from('reservations')
    .select('tour_date_id, created_at')
    .in('tour_date_id', tourDateIds)
    .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])
  for (const r of data || []) {
    const prev = map.get(r.tour_date_id)
    if (!prev || (r.created_at && r.created_at > prev)) {
      map.set(r.tour_date_id, r.created_at)
    }
  }
  return map
}

// Live days between today (midnight) and the tour date (midnight).
function computeDaysBeforeTour(tourDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const t = new Date(tourDate)
  t.setHours(0, 0, 0, 0)
  return Math.ceil((t.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// Current alert stage derived from live days remaining.
// <=7 && >5 => 7 days, <=5 && >3 => 5 days, <=3 => decision required.
function computeAlertStage(
  days: number
): 'LOW_PARTICIPANTS_7_DAYS' | 'LOW_PARTICIPANTS_5_DAYS' | 'SUPPLIER_DECISION_REQUIRED_3_DAYS' | null {
  if (days <= 3) return 'SUPPLIER_DECISION_REQUIRED_3_DAYS'
  if (days <= 5) return 'LOW_PARTICIPANTS_5_DAYS'
  if (days <= 7) return 'LOW_PARTICIPANTS_7_DAYS'
  return null
}

// LIVE source of truth for the Minimum Participants page.
//
// Issues are CALCULATED from public.tour_dates + public.tours + public.reservations,
// not read from minimum_participant_alerts. The alerts table is only merged in to
// surface status / supplier decisions / history. A new open tour date with zero or
// few active participants therefore appears immediately, even if no alert row exists.
export async function fetchMinimumParticipantAlerts(filters?: {
  status?: string
  alert_stage?: string
}) {
  const supabase = await createClient()

  try {
    // Performance: bounded window of today-7 .. today+7 only. No full historical
    // scan, no email checks. Past dates (within 7 days) appear only if they have an
    // existing alert/history row; upcoming dates surface as live issues.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const windowStart = new Date(today)
    windowStart.setDate(windowStart.getDate() - 7)
    const windowEnd = new Date(today)
    windowEnd.setDate(windowEnd.getDate() + 7)
    const startStr = windowStart.toISOString().split('T')[0]
    const endStr = windowEnd.toISOString().split('T')[0]

    // All tour dates in the window (with tour name). We intentionally do NOT filter
    // is_open / supplier_status here so that history rows for cancelled dates can
    // still be shown; open/upcoming filtering for LIVE issues happens in code below.
    const { data: windowDates, error: tdError } = await supabase
      .from('tour_dates')
      .select('id, tour_date, is_open, supplier_status, tour:tours(id, name)')
      .gte('tour_date', startStr)
      .lte('tour_date', endStr)
      .order('tour_date', { ascending: true })
      .limit(500)

    if (tdError) {
      console.error('Error fetching tour dates:', tdError)
      return { alerts: [], error: tdError.message }
    }

    const windowList = windowDates || []
    const windowIds = windowList.map((t) => t.id)
    if (windowIds.length === 0) {
      return { alerts: [], error: null }
    }

    // Existing alert rows for these tour dates: used for status / decisions / history.
    const { data: alertRows, error: arError } = await supabase
      .from('minimum_participant_alerts')
      .select('*')
      .in('tour_date_id', windowIds)
      .order('created_at', { ascending: false })

    if (arError) {
      console.error('Error fetching alert rows:', arError)
      return { alerts: [], error: arError.message }
    }

    const alertsByTd = new Map<string, MinimumParticipantAlert[]>()
    for (const r of (alertRows || []) as MinimumParticipantAlert[]) {
      const list = alertsByTd.get(r.tour_date_id) || []
      list.push(r)
      alertsByTd.set(r.tour_date_id, list)
    }

    // Live active participants (SUM of WAITING/CONFIRMED) for every window date.
    const liveMap = await getActiveParticipantsMap(supabase, windowIds)
    // Latest active-reservation time per date, to detect bookings made after a
    // supplier decision (which makes that decision stale).
    const latestActiveMap = await getLatestActiveReservationMap(supabase, windowIds)

    const merged: MinimumParticipantAlert[] = []
    const usedAlertIds = new Set<string>()
    const nowIso = new Date().toISOString()

    // Pass 1 — LIVE issues: open, upcoming, in-window dates below the minimum.
    const debugIncluded: string[] = []
    const debugExcluded: { id: string; reason: string }[] = []
    for (const td of windowList) {
      const tourRel = Array.isArray(td.tour) ? td.tour[0] : td.tour
      const tourInfo = {
        id: td.id,
        tour_date: td.tour_date,
        is_open: td.is_open,
        supplier_status: td.supplier_status,
        tour: tourRel ? { id: (tourRel as any).id, name: (tourRel as any).name } : undefined,
      }
      const active = liveMap.get(td.id) || 0
      const days = computeDaysBeforeTour(td.tour_date)
      const stage = computeAlertStage(days)
      const rows = alertsByTd.get(td.id) || []
      const isOpenDate = td.is_open === true && td.supplier_status !== 'CANCELLED'
      // A final supplier decision (KEPT or CANCELLED) normally removes the date from
      // the operational list. RESOLVED does NOT block: if the count drops below the
      // minimum again the date must resurface (the live `active < MIN` check handles
      // that).
      const decidedRow = rows.find((r) => r.status === 'KEPT' || r.status === 'CANCELLED')
      // A CANCELLED decision is STALE only if the date was genuinely re-opened
      // (is_open + not supplier-cancelled) AND received an active booking after the
      // decision time. In that case the cancellation no longer reflects reality, so
      // the date resurfaces as a live issue. KEPT decisions are never treated as
      // stale — a kept tour gaining bookings stays "kept" and remains visible.
      const latestActiveAt = latestActiveMap.get(td.id)
      const decisionStale =
        !!decidedRow &&
        decidedRow.status === 'CANCELLED' &&
        isOpenDate &&
        !!latestActiveAt &&
        !!decidedRow.supplier_decision_at &&
        latestActiveAt > decidedRow.supplier_decision_at
      const decided = decidedRow && !decisionStale

      // Persistent decided rows: a non-stale KEPT/CANCELLED decision stays visible in
      // the main table for today/future dates (days >= 0) until the tour date passes.
      // It carries its stored status/decision and shows live participants, but no
      // "decision required" warning. Past decided rows fall through and are excluded.
      if (decided && days >= 0) {
        usedAlertIds.add(decidedRow!.id)
        merged.push({
          ...decidedRow!,
          active_participants: active,
          days_before_tour: days,
          tour_date: tourInfo,
          alert_exists: true,
        })
        debugIncluded.push(td.id)
        continue
      }

      // A live issue requires 1..3 active participants (never show 0/4) on an open,
      // upcoming, in-window date with no still-valid supplier decision recorded.
      const isLiveIssue =
        isOpenDate &&
        active >= 1 &&
        active < MIN_PARTICIPANTS_REQUIRED &&
        days >= 0 &&
        stage !== null &&
        !decided

      if (!isLiveIssue) {
        // Collect a precise exclusion reason for server debug output (item 8).
        let reason = 'included'
        if (!isOpenDate) {
          reason = td.is_open !== true ? 'is_open = false' : 'supplier_status = CANCELLED'
        } else if (decidedRow && !decisionStale) {
          reason = `supplier decision already recorded (${decidedRow.status})`
        } else if (active < 1) {
          reason = '0 active participants'
        } else if (active >= MIN_PARTICIPANTS_REQUIRED) {
          reason = `active_participants >= ${MIN_PARTICIPANTS_REQUIRED}`
        } else if (days < 0) {
          reason = 'tour date is in the past'
        } else if (stage === null) {
          reason = 'outside 7-day alert window'
        }
        debugExcluded.push({ id: td.id, reason })
        continue
      }
      debugIncluded.push(td.id)

      const openAlert = rows.find((r) => r.status === 'OPEN')
      if (openAlert) {
        // Real alert row exists: keep its status/decision but use LIVE values.
        usedAlertIds.add(openAlert.id)
        merged.push({
          ...openAlert,
          active_participants: active,
          days_before_tour: days,
          alert_stage: stage!,
          tour_date: tourInfo,
          alert_exists: true,
        })
      } else {
        // No matching alert row yet: surface as a live issue ("NOT CREATED").
        merged.push({
          id: `live:${td.id}`,
          tour_date_id: td.id,
          alert_stage: stage!,
          active_participants: active,
          minimum_required: MIN_PARTICIPANTS_REQUIRED,
          days_before_tour: days,
          status: 'NOT CREATED',
          supplier_decision: null,
          supplier_decision_at: null,
          notes: null,
          created_at: nowIso,
          updated_at: nowIso,
          tour_date: tourInfo,
          alert_exists: false,
        })
      }
    }

    // NOTE: the main table includes live issues PLUS non-stale decided (KEPT/CANCELLED)
    // rows for today/future dates so a decision stays visible until the tour date
    // passes. Past dates (days < 0) and RESOLVED-only history are excluded here; full
    // history is served on demand by fetchMinimumParticipantHistory().
    // `usedAlertIds` is retained only to document which DB rows are consumed.
    void usedAlertIds

    // Optional alert-stage filter (status filter is irrelevant: every row is live).
    let out = merged
    if (filters?.alert_stage && filters.alert_stage !== 'all') {
      out = out.filter((a) => a.alert_stage === filters.alert_stage)
    }

    // Sort by tour_date ascending (soonest operational risk first).
    out.sort((a, b) => {
      const da = (a.tour_date as any)?.tour_date || ''
      const db = (b.tour_date as any)?.tour_date || ''
      return da < db ? -1 : da > db ? 1 : 0
    })

    // Item 8: temporary server-side debug output for the Minimum Participants fetch.
    console.log('[v0] MinParticipants fetch window:', startStr, '->', endStr)
    console.log('[v0] MinParticipants open tour_dates in window:', windowList.length)
    console.log('[v0] MinParticipants tour_date_ids:', windowIds)
    console.log(
      '[v0] MinParticipants active participants:',
      windowList.map((t) => ({ id: t.id, active: liveMap.get(t.id) || 0 }))
    )
    console.log('[v0] MinParticipants INCLUDED:', debugIncluded)
    console.log('[v0] MinParticipants EXCLUDED:', debugExcluded)

    return { alerts: out, error: null }
  } catch (err) {
    console.error('[v0] fetchMinimumParticipantAlerts failed:', err)
    return { alerts: [], error: err instanceof Error ? err.message : 'Failed to load issues' }
  }
}

// History for the collapsed "Past / Resolved Minimum Participant Alerts" section.
// Loaded ONLY when the section is expanded (rule 15: no history scan on page load).
// Returns decided / resolved rows (CANCELLED, KEPT, RESOLVED) plus past OPEN rows
// that are no longer operational. Bounded to a recent window for performance.
export async function fetchMinimumParticipantHistory() {
  const supabase = await createClient()

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Look back 60 days for history; do not include far-future rows here.
    const start = new Date(today)
    start.setDate(start.getDate() - 60)
    const end = new Date(today)
    end.setDate(end.getDate() + 7)
    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]

    const { data: dates, error: tdError } = await supabase
      .from('tour_dates')
      .select('id, tour_date, is_open, supplier_status, tour:tours(id, name)')
      .gte('tour_date', startStr)
      .lte('tour_date', endStr)
      .order('tour_date', { ascending: false })
      .limit(500)

    if (tdError) return { alerts: [], error: tdError.message }

    const dateList = dates || []
    const idList = dateList.map((d) => d.id)
    if (idList.length === 0) return { alerts: [], error: null }

    const tourInfoById = new Map<string, any>()
    for (const d of dateList) {
      const tourRel = Array.isArray(d.tour) ? d.tour[0] : d.tour
      tourInfoById.set(d.id, {
        id: d.id,
        tour_date: d.tour_date,
        tour: tourRel ? { id: (tourRel as any).id, name: (tourRel as any).name } : undefined,
      })
    }

    // Only decided / resolved rows belong in history.
    const { data: rows, error: arError } = await supabase
      .from('minimum_participant_alerts')
      .select('*')
      .in('tour_date_id', idList)
      .in('status', ['CANCELLED', 'KEPT', 'RESOLVED'])
      .order('updated_at', { ascending: false })
      .limit(500)

    if (arError) return { alerts: [], error: arError.message }

    const liveMap = await getActiveParticipantsMap(supabase, idList)

    const history = ((rows || []) as MinimumParticipantAlert[]).map((r) => ({
      ...r,
      active_participants: liveMap.get(r.tour_date_id) ?? r.active_participants,
      tour_date: tourInfoById.get(r.tour_date_id),
      alert_exists: true,
    }))

    return { alerts: history, error: null }
  } catch (err) {
    console.error('[v0] fetchMinimumParticipantHistory failed:', err)
    return { alerts: [], error: err instanceof Error ? err.message : 'Failed to load history' }
  }
}

export interface MinimumParticipantCandidate {
  tour_date_id: string
  tour_date: string
  tour_name: string
  is_open: boolean
  supplier_status: string | null
  active_participants: number
  included: boolean
  exclusion_reason: string | null
}

// Item 9: "Debug Visible Candidate Dates". Lists every tour_date in the next 7 days
// (today .. today+7) with the exact data used for the inclusion decision, including
// 0/4 dates (shown with an exclusion reason). Uses the SAME rules as the live fetch.
export async function fetchMinimumParticipantCandidates(): Promise<{
  candidates: MinimumParticipantCandidate[]
  error: string | null
}> {
  const supabase = await createClient()
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setDate(end.getDate() + 7)
    const startStr = today.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]

    const { data: dates, error } = await supabase
      .from('tour_dates')
      .select('id, tour_date, is_open, supplier_status, tour:tours(id, name)')
      .gte('tour_date', startStr)
      .lte('tour_date', endStr)
      .order('tour_date', { ascending: true })
      .limit(500)

    if (error) return { candidates: [], error: error.message }

    const list = dates || []
    const ids = list.map((d) => d.id)
    const liveMap = await getActiveParticipantsMap(supabase, ids)

    const candidates: MinimumParticipantCandidate[] = list.map((td) => {
      const tourRel = Array.isArray(td.tour) ? td.tour[0] : td.tour
      const active = liveMap.get(td.id) || 0
      const days = computeDaysBeforeTour(td.tour_date)
      const stage = computeAlertStage(days)
      const isOpenDate = td.is_open === true && td.supplier_status !== 'CANCELLED'

      let included = false
      let reason: string | null = null
      if (td.is_open !== true) {
        reason = 'is_open = false'
      } else if (td.supplier_status === 'CANCELLED') {
        reason = 'supplier_status = CANCELLED'
      } else if (active < 1) {
        reason = '0 active participants'
      } else if (active >= MIN_PARTICIPANTS_REQUIRED) {
        reason = `active_participants >= ${MIN_PARTICIPANTS_REQUIRED}`
      } else if (days < 0) {
        reason = 'tour date is in the past'
      } else if (stage === null) {
        reason = 'outside 7-day alert window'
      } else if (isOpenDate) {
        included = true
      }

      return {
        tour_date_id: td.id,
        tour_date: td.tour_date,
        tour_name: (tourRel as any)?.name || 'Unknown Tour',
        is_open: td.is_open === true,
        supplier_status: td.supplier_status ?? null,
        active_participants: active,
        included,
        exclusion_reason: reason,
      }
    })

    return { candidates, error: null }
  } catch (err) {
    console.error('[v0] fetchMinimumParticipantCandidates failed:', err)
    return { candidates: [], error: err instanceof Error ? err.message : 'Failed to load candidates' }
  }
}

export async function resolveAlert(alertId: string, decision: 'KEEP_TOUR' | 'CANCEL_TOUR', notes?: string) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'minimum_participants_action_access')) {
    return { success: false, error: 'Access denied' }
  }
  const supabase = await createClient()
  
  // Get the alert details first
  const { data: alert, error: fetchError } = await supabase
    .from('minimum_participant_alerts')
    .select(`
      *,
      tour_date:tour_dates(
        id,
        tour_date,
        notes,
        tour:tours(id, name)
      )
    `)
    .eq('id', alertId)
    .single()
  
  if (fetchError || !alert) {
    return { success: false, error: 'Alert not found' }
  }
  
  const newStatus = decision === 'KEEP_TOUR' ? 'KEPT' : 'CANCELLED'
  const nowIso = new Date().toISOString()
  // Capture before-values for targeted debug logging (requirement H).
  const statusBefore = alert.status
  const decisionBefore = alert.supplier_decision ?? null

  // Update the alert
  const { error: updateError } = await supabase
    .from('minimum_participant_alerts')
    .update({
      status: newStatus,
      supplier_decision: decision,
      supplier_decision_at: nowIso,
      notes: notes || null,
      updated_at: nowIso
    })
    .eq('id', alertId)
  
  if (updateError) {
    console.log('[v0] resolveAlert update FAILED:', {
      alertId,
      tourDateId: alert.tour_date_id,
      decision,
      error: updateError.message,
    })
    return { success: false, error: updateError.message }
  }

  console.log('[v0] resolveAlert decision applied:', {
    alertId,
    tourDateId: alert.tour_date_id,
    decision,
    statusBefore,
    statusAfter: newStatus,
    supplierDecisionBefore: decisionBefore,
    supplierDecisionAfter: decision,
    supplierDecisionAt: nowIso,
  })
  
  // If cancelling, update the tour_date status, cancel reservations, and send emails
  if (decision === 'CANCEL_TOUR') {
    const tourDate = alert.tour_date as any
    const cancellationNote = 'Cancelled due to minimum participants not reached.'
    
    // Update the tour date with cancellation note appended
    const existingNotes = tourDate?.notes ? `${tourDate.notes}\n` : ''
    await supabase
      .from('tour_dates')
      .update({ 
        supplier_status: 'CANCELLED',
        is_open: false,
        notes: `${existingNotes}${cancellationNote}`,
        updated_at: nowIso
      })
      .eq('id', alert.tour_date_id)
    
    // Find all active reservations for this tour date. Process ONLY
    // WAITING FOR CONFIRMATION and CONFIRMED. Never touch CANCELLED / NOT CONFIRMED.
    const { data: activeReservations, error: activeError } = await supabase
      .from('reservations')
      .select('id, reservation_number, voucher_number, lead_passenger_name, whatsapp_number, participants, internal_notes, agent_name, agent_email, status')
      .eq('tour_date_id', alert.tour_date_id)
      .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])

    if (activeError) {
      return {
        success: false,
        error: `Failed to load active reservations: ${activeError.message}`,
        allProcessed: false,
        activeReservationsFound: 0,
        reservationsCancelled: 0,
        emailLogsCreated: 0,
        emailsSent: 0,
        emailsSkippedDuplicate: 0,
        emailsFailed: 0,
        details: []
      } satisfies CancellationResult
    }

    const reservations = activeReservations || []
    const details: CancellationEmailDetail[] = []
    let reservationsCancelled = 0
    let emailLogsCreated = 0
    let emailsSent = 0
    let emailsSkippedDuplicate = 0
    let emailsFailed = 0
    let allProcessed = true

    for (const reservation of reservations) {
      const previousStatus = reservation.status || 'UNKNOWN'

      // Build updated internal notes
      const updatedNotes = reservation.internal_notes
        ? `${reservation.internal_notes}\n${cancellationNote}`
        : cancellationNote

      // Cancel this specific reservation
      const { error: resUpdateError } = await supabase
        .from('reservations')
        .update({
          status: 'CANCELLED',
          cancelled_at: nowIso,
          internal_notes: updatedNotes
        })
        .eq('id', reservation.id)

      if (resUpdateError) {
        console.error('[v0] Failed to cancel reservation:', reservation.id, resUpdateError.message)
        allProcessed = false
        details.push({
          reservation_id: reservation.id,
          voucher_number: reservation.voucher_number || 'N/A',
          previous_status: previousStatus,
          new_status: previousStatus,
          agent_email: reservation.agent_email || null,
          email_log_created: false,
          email_sent: false,
          skipped_duplicate: false,
          error: `Failed to cancel reservation: ${resUpdateError.message}`
        })
        continue
      }

      reservationsCancelled++

      // Send the cancellation email (one per reservation) with duplicate
      // prevention + retry. One failure never stops the rest of the loop.
      const detail = await sendCancellationEmailForReservation(
        supabase,
        { ...reservation, cancelled_at: nowIso, internal_notes: updatedNotes },
        { name: tourDate?.tour?.name, tour_date: tourDate?.tour_date },
        nowIso,
        previousStatus
      )
      details.push(detail)

      if (detail.email_log_created) emailLogsCreated++
      if (detail.skipped_duplicate) emailsSkippedDuplicate++
      else if (detail.email_sent) emailsSent++
      else {
        emailsFailed++
        allProcessed = false
      }

      // Pace sends to stay under Resend's rate limit.
      await sleep(700)
    }

    console.log('[v0] resolveAlert CANCEL summary:', {
      alertId,
      tourDateId: alert.tour_date_id,
      reservationsEligible: reservations.length,
      reservationsCancelled,
      emailsSent,
      emailsSkippedDuplicate,
      emailsFailed,
    })

    revalidatePath('/admin/alerts')
    revalidatePath('/admin/minimum-participants')
    revalidatePath('/admin/open-dates')
    revalidatePath('/admin/reservations')
    revalidatePath('/admin/email-logs')

    return {
      success: true,
      allProcessed,
      activeReservationsFound: reservations.length,
      reservationsCancelled,
      emailLogsCreated,
      emailsSent,
      emailsSkippedDuplicate,
      emailsFailed,
      message: `Tour cancelled due to minimum participants. Active reservations: ${reservations.length}. Cancelled: ${reservationsCancelled}. Emails sent: ${emailsSent}. Skipped (already sent): ${emailsSkippedDuplicate}. Failed: ${emailsFailed}.`,
      details
    } satisfies CancellationResult
  }
  
  revalidatePath('/admin/alerts')
  revalidatePath('/admin/minimum-participants')
  revalidatePath('/admin/open-dates')
  revalidatePath('/admin/reservations')
  return { success: true }
}

// Repair helper: for a specific alert/tour_date, find reservations that are already
// CANCELLED (due to minimum participants) but never got a SENT cancellation email,
// and send the missing email now. Never duplicates a SENT email.
export async function repairMissingCancellationEmails(alertId: string): Promise<CancellationResult> {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'minimum_participants_action_access')) {
    return { success: false, error: 'Access denied', allProcessed: false, activeReservationsFound: 0, reservationsCancelled: 0, emailLogsCreated: 0, emailsSent: 0, emailsSkippedDuplicate: 0, emailsFailed: 0, message: 'Access denied', details: [] }
  }
  const supabase = await createClient()

  const empty: CancellationResult = {
    success: true,
    allProcessed: true,
    activeReservationsFound: 0,
    reservationsCancelled: 0,
    emailLogsCreated: 0,
    emailsSent: 0,
    emailsSkippedDuplicate: 0,
    emailsFailed: 0,
    details: []
  }

  // Load the alert + tour info.
  const { data: alert, error: alertError } = await supabase
    .from('minimum_participant_alerts')
    .select(`
      *,
      tour_date:tour_dates(
        id,
        tour_date,
        tour:tours(id, name)
      )
    `)
    .eq('id', alertId)
    .single()

  if (alertError || !alert) {
    return { ...empty, success: false, error: 'Alert not found' }
  }

  const tourDate = alert.tour_date as any
  const nowIso = new Date().toISOString()

  // Find CANCELLED reservations on this tour date that were cancelled for the
  // minimum-participants reason (internal_notes mentions it) OR, if the whole
  // alert was cancelled, every CANCELLED reservation on the date qualifies.
  const { data: cancelledReservations, error: resError } = await supabase
    .from('reservations')
    .select('id, reservation_number, voucher_number, lead_passenger_name, whatsapp_number, participants, internal_notes, agent_name, agent_email, status, cancelled_at')
    .eq('tour_date_id', alert.tour_date_id)
    .eq('status', 'CANCELLED')

  if (resError) {
    return { ...empty, success: false, error: `Failed to load reservations: ${resError.message}` }
  }

  const alertWasCancelled = alert.status === 'CANCELLED'
  const eligible = (cancelledReservations || []).filter((r) => {
    if (alertWasCancelled) return true
    const notes = (r.internal_notes || '').toLowerCase()
    return notes.includes('minimum') && notes.includes('participants')
  })

  const details: CancellationEmailDetail[] = []
  let emailLogsCreated = 0
  let emailsSent = 0
  let emailsSkippedDuplicate = 0
  let emailsFailed = 0
  let allProcessed = true

  for (const reservation of eligible) {
    const detail = await sendCancellationEmailForReservation(
      supabase,
      reservation,
      { name: tourDate?.tour?.name, tour_date: tourDate?.tour_date },
      nowIso,
      reservation.status || 'CANCELLED'
    )
    // The reservation was already cancelled before repair.
    detail.previous_status = 'CANCELLED'
    details.push(detail)

    if (detail.email_log_created) emailLogsCreated++
    if (detail.skipped_duplicate) emailsSkippedDuplicate++
    else if (detail.email_sent) emailsSent++
    else {
      emailsFailed++
      allProcessed = false
    }

    await sleep(700)
  }

  revalidatePath('/admin/alerts')
  revalidatePath('/admin/minimum-participants')
  revalidatePath('/admin/email-logs')

  return {
    success: true,
    allProcessed,
    activeReservationsFound: eligible.length,
    reservationsCancelled: 0,
    emailLogsCreated,
    emailsSent,
    emailsSkippedDuplicate,
    emailsFailed,
    message: `Repair complete. Eligible cancelled reservations: ${eligible.length}. Emails sent: ${emailsSent}. Skipped (already sent): ${emailsSkippedDuplicate}. Failed: ${emailsFailed}.`,
    details
  }
}

// ----------------------------------------------------------------------------
// DEBUG: inspect Minimum Participants cancellation email reliability.
// Read-only inspection. Explains, per reservation, whether it should have
// received a cancellation email and what actually happened to its email_log.
// ----------------------------------------------------------------------------

export interface CancellationDebugReservation {
  reservation_id: string
  voucher_number: string
  reservation_number: string
  lead_passenger_name: string
  current_status: string
  participants: number | null
  agent_email: string | null
  cancelled_at: string | null
  internal_notes: string
  should_receive: boolean
  cancelled_by_min_participants: boolean
  has_cancelled_log: boolean
  has_sent_log: boolean
  latest_log_status: 'SENT' | 'PENDING' | 'FAILED' | 'ERROR' | 'missing'
  sent_at: string | null
  error_message: string | null
  needs_action: boolean
  skipped_duplicate_reason: string | null
  diagnosis: string
}

export interface CancellationDebugAlert {
  alert_id: string
  alert_status: string
  tour_date_id: string
  tour_name: string
  tour_date: string | null
  total_reservations: number
  reservations: CancellationDebugReservation[]
}

export interface CancellationDebugResult {
  success: boolean
  error?: string
  generated_at: string
  alerts: CancellationDebugAlert[]
  totals: {
    cancelledAlerts: number
    reservations: number
    shouldReceive: number
    sent: number
    missingOrFailed: number
  }
}

// Inspect every CANCELLED minimum participant alert and report, per reservation,
// exactly why it did or did not receive a cancellation email.
export async function debugCancellationEmails(): Promise<CancellationDebugResult> {
  const supabase = await createClient()
  const generatedAt = new Date().toISOString()

  const empty: CancellationDebugResult = {
    success: true,
    generated_at: generatedAt,
    alerts: [],
    totals: { cancelledAlerts: 0, reservations: 0, shouldReceive: 0, sent: 0, missingOrFailed: 0 }
  }

  // 1. All CANCELLED minimum participant alerts.
  const { data: alerts, error: alertsError } = await supabase
    .from('minimum_participant_alerts')
    .select(`
      id,
      status,
      tour_date_id,
      tour_date:tour_dates(
        id,
        tour_date,
        tour:tours(id, name)
      )
    `)
    .eq('status', 'CANCELLED')
    .order('updated_at', { ascending: false })

  if (alertsError) {
    return { ...empty, success: false, error: `Failed to load alerts: ${alertsError.message}` }
  }

  const debugAlerts: CancellationDebugAlert[] = []
  let totalReservations = 0
  let totalShouldReceive = 0
  let totalSent = 0
  let totalMissingOrFailed = 0

  for (const alert of alerts || []) {
    const tourDate = alert.tour_date as any

    // 2. All reservations for this tour_date_id (every status, so we can explain each).
    const { data: reservations, error: resError } = await supabase
      .from('reservations')
      .select('id, voucher_number, reservation_number, lead_passenger_name, status, participants, agent_email, cancelled_at, internal_notes')
      .eq('tour_date_id', alert.tour_date_id)
      .order('created_at', { ascending: true })

    if (resError) {
      return { ...empty, success: false, error: `Failed to load reservations: ${resError.message}` }
    }

    const debugReservations: CancellationDebugReservation[] = []

    for (const r of reservations || []) {
      // 3. All CANCELLED email logs for this reservation (latest first).
      const { data: logs } = await supabase
        .from('email_logs')
        .select('id, status, sent_at, error_message, created_at')
        .eq('reservation_id', r.id)
        .eq('email_type', 'CANCELLED')
        .order('created_at', { ascending: false })

      const logRows = logs || []
      const hasCancelledLog = logRows.length > 0
      const hasSentLog = logRows.some((l) => l.status === 'SENT')
      const latest = logRows[0]
      const latestStatus = (latest?.status as CancellationDebugReservation['latest_log_status']) || 'missing'
      const sentLog = logRows.find((l) => l.status === 'SENT')
      const sentAt = sentLog?.sent_at || null
      const errorMessage = latest?.status === 'FAILED' || latest?.status === 'ERROR' ? latest?.error_message || null : null

      const notes = r.internal_notes || ''
      const notesLower = notes.toLowerCase()
      // The cancel action stamps "Cancelled due to minimum participants not reached."
      const cancelledByMin =
        r.status === 'CANCELLED' && notesLower.includes('minimum participants')

      // Should receive iff it was cancelled by the min-participants action
      // (which only touches WAITING FOR CONFIRMATION / CONFIRMED reservations).
      const shouldReceive = cancelledByMin

      const skippedDuplicateReason = hasSentLog
        ? 'A SENT CANCELLED email already exists for this reservation_id.'
        : null

      const needsAction = shouldReceive && !hasSentLog

      // Build a human-readable diagnosis explaining the outcome.
      let diagnosis: string
      if (!cancelledByMin) {
        if (r.status === 'CANCELLED') {
          diagnosis =
            'NOT a minimum-participants cancellation (internal notes do not contain the min-participants reason). Likely cancelled individually or via the Availability Calendar; excluded from this flow.'
        } else if (r.status === 'NOT CONFIRMED') {
          diagnosis = 'Status is NOT CONFIRMED - never eligible for a minimum-participants cancellation email.'
        } else {
          diagnosis = `Status is "${r.status}" - not cancelled by the minimum-participants action, so no cancellation email is expected.`
        }
      } else if (hasSentLog) {
        diagnosis = `Email correctly SENT${sentAt ? ` at ${sentAt}` : ''}. Duplicate protection would skip any resend.`
      } else if (latestStatus === 'FAILED' || latestStatus === 'ERROR') {
        diagnosis = `Should have received a cancellation email, but the latest log is ${latestStatus}${errorMessage ? `: ${errorMessage}` : ''}. Eligible for resend.`
      } else if (latestStatus === 'PENDING') {
        diagnosis = 'Should have received a cancellation email, but the log is stuck at PENDING (send never completed). Eligible for resend.'
      } else {
        diagnosis = 'Should have received a cancellation email, but NO CANCELLED email log exists. It was never attempted. Eligible for send.'
      }

      const row: CancellationDebugReservation = {
        reservation_id: r.id,
        voucher_number: r.voucher_number || 'N/A',
        reservation_number: r.reservation_number || 'N/A',
        lead_passenger_name: r.lead_passenger_name || 'N/A',
        current_status: r.status || 'UNKNOWN',
        participants: r.participants ?? null,
        agent_email: r.agent_email || null,
        cancelled_at: r.cancelled_at || null,
        internal_notes: notes,
        should_receive: shouldReceive,
        cancelled_by_min_participants: cancelledByMin,
        has_cancelled_log: hasCancelledLog,
        has_sent_log: hasSentLog,
        latest_log_status: latestStatus,
        sent_at: sentAt,
        error_message: errorMessage,
        needs_action: needsAction,
        skipped_duplicate_reason: skippedDuplicateReason,
        diagnosis
      }

      debugReservations.push(row)
      totalReservations++
      if (shouldReceive) totalShouldReceive++
      if (hasSentLog) totalSent++
      if (needsAction) totalMissingOrFailed++
    }

    debugAlerts.push({
      alert_id: alert.id,
      alert_status: alert.status,
      tour_date_id: alert.tour_date_id,
      tour_name: tourDate?.tour?.name || 'N/A',
      tour_date: tourDate?.tour_date || null,
      total_reservations: debugReservations.length,
      reservations: debugReservations
    })
  }

  return {
    success: true,
    generated_at: generatedAt,
    alerts: debugAlerts,
    totals: {
      cancelledAlerts: debugAlerts.length,
      reservations: totalReservations,
      shouldReceive: totalShouldReceive,
      sent: totalSent,
      missingOrFailed: totalMissingOrFailed
    }
  }
}

// Send (or resend) ONE missing/failed cancellation email for a single reservation.
// Reuses the same strict duplicate-protected, retry/backoff send helper.
export async function sendMissingCancellationEmail(reservationId: string): Promise<CancellationEmailDetail> {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'minimum_participants_action_access')) {
    return { reservation_id: reservationId, voucher_number: '', reservation_number: '', lead_passenger_name: '', participants: 0, agent_email: '', email_sent: false, email_log_created: false, skipped_duplicate: false, error: 'Access denied' }
  }
  const supabase = await createClient()
  const nowIso = new Date().toISOString()

  const { data: reservation, error: resError } = await supabase
    .from('reservations')
    .select('id, reservation_number, voucher_number, lead_passenger_name, whatsapp_number, participants, internal_notes, agent_name, agent_email, status, cancelled_at, tour_date_id')
    .eq('id', reservationId)
    .single()

  if (resError || !reservation) {
    return {
      reservation_id: reservationId,
      voucher_number: 'N/A',
      previous_status: 'UNKNOWN',
      new_status: 'UNKNOWN',
      agent_email: null,
      email_log_created: false,
      email_sent: false,
      skipped_duplicate: false,
      error: resError?.message || 'Reservation not found'
    }
  }

  // Load tour info for the email body.
  const { data: tourDate } = await supabase
    .from('tour_dates')
    .select('tour_date, tour:tours(name)')
    .eq('id', reservation.tour_date_id)
    .single()

  const tourInfo = {
    name: (tourDate?.tour as any)?.name || null,
    tour_date: tourDate?.tour_date || null
  }

  const detail = await sendCancellationEmailForReservation(
    supabase,
    reservation,
    tourInfo,
    nowIso,
    reservation.status || 'CANCELLED'
  )

  revalidatePath('/admin/minimum-participants')
  revalidatePath('/admin/email-logs')

  return detail
}

export async function checkAndCreateAlerts(): Promise<CheckResult> {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'minimum_participants_action_access')) {
    return { success: false, error: 'Access denied', alertsCreated: 0, alertsSkipped: 0, emailLogsCreated: 0, emailLogsSkipped: 0, details: [] }
  }
  const supabase = await createClient()
  const today = new Date()
  
  const result: CheckResult = {
    success: true,
    alertsCreated: 0,
    alertsSkipped: 0,
    emailLogsCreated: 0,
    emailLogsSkipped: 0,
    details: []
  }
  
  // Get all open tour dates in the next 7 days
  const sevenDaysFromNow = new Date(today)
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)
  
  const { data: upcomingDates, error } = await supabase
    .from('tour_dates')
    .select(`
      id,
      tour_date,
      supplier_status,
      is_open,
      tour:tours(id, name)
    `)
    .gte('tour_date', today.toISOString().split('T')[0])
    .lte('tour_date', sevenDaysFromNow.toISOString().split('T')[0])
    .eq('is_open', true)
    .not('supplier_status', 'eq', 'CANCELLED')
  
  if (error) {
    console.error('Error fetching upcoming tour dates:', error)
    return { ...result, success: false, error: error.message }
  }
  
  for (const tourDate of upcomingDates || []) {
    const minimumRequired = 4
    const tourName = (tourDate.tour as any)?.name || 'Unknown Tour'
    const tourDateStr = tourDate.tour_date
    const nowIso = new Date().toISOString()

    // LIVE active participants = SUM of WAITING/CONFIRMED reservation participants.
    const participants = await getActiveParticipants(supabase, tourDate.id)
    // LIVE days remaining, recalculated from today.
    const daysUntilTour = computeDaysBeforeTour(tourDate.tour_date)

    // K: Respect supplier decisions — never re-alert a tour date already KEPT or CANCELLED.
    const { data: decidedAlerts } = await supabase
      .from('minimum_participant_alerts')
      .select('id')
      .eq('tour_date_id', tourDate.id)
      .in('status', ['KEPT', 'CANCELLED'])
      .limit(1)

    if (decidedAlerts && decidedAlerts.length > 0) {
      result.details.push(`Skipped (supplier decision already made): ${tourName} on ${tourDateStr}`)
      continue
    }

    // D: Minimum reached -> resolve all OPEN alerts, create no new alerts or emails.
    if (participants >= minimumRequired) {
      const { data: openToResolve } = await supabase
        .from('minimum_participant_alerts')
        .select('id')
        .eq('tour_date_id', tourDate.id)
        .eq('status', 'OPEN')

      if (openToResolve && openToResolve.length > 0) {
        await supabase
          .from('minimum_participant_alerts')
          .update({
            status: 'RESOLVED',
            active_participants: participants,
            days_before_tour: daysUntilTour,
            updated_at: nowIso
          })
          .eq('tour_date_id', tourDate.id)
          .eq('status', 'OPEN')
        result.details.push(`Resolved ${openToResolve.length} alert(s): ${tourName} on ${tourDateStr} now has ${participants}/${minimumRequired} participants`)
      }
      continue
    }

    // Below minimum -> determine the CURRENT stage from live days remaining.
    const alertStage = computeAlertStage(daysUntilTour)
    if (!alertStage) {
      continue
    }

    // Maintain exactly ONE OPEN alert per tour date, always reflecting the CURRENT
    // stage, live participants and live days. This guarantees the page never shows a
    // stale alert_stage or a stale participant count, and never accumulates duplicate
    // OPEN rows when the stage advances (7 -> 5 -> 3 days).
    const { data: openAlerts } = await supabase
      .from('minimum_participant_alerts')
      .select('id, alert_stage')
      .eq('tour_date_id', tourDate.id)
      .eq('status', 'OPEN')
      .order('created_at', { ascending: false })

    let isNewStage = false

    if (openAlerts && openAlerts.length > 0) {
      const [current, ...duplicates] = openAlerts
      const previousStage = current.alert_stage

      // Advance the surviving alert to the current stage with live values.
      await supabase
        .from('minimum_participant_alerts')
        .update({
          alert_stage: alertStage,
          active_participants: participants,
          days_before_tour: daysUntilTour,
          updated_at: nowIso
        })
        .eq('id', current.id)

      // Collapse any older duplicate OPEN alerts for the same tour date.
      if (duplicates.length > 0) {
        await supabase
          .from('minimum_participant_alerts')
          .update({ status: 'RESOLVED', updated_at: nowIso })
          .in('id', duplicates.map((d) => d.id))
      }

      if (previousStage !== alertStage) {
        isNewStage = true
        result.alertsCreated++
        result.details.push(`Alert advanced ${previousStage} -> ${alertStage}: ${tourName} on ${tourDateStr} (${participants}/${minimumRequired}, ${daysUntilTour}d left)`)
      } else {
        result.alertsSkipped++
        result.details.push(`Alert updated (${alertStage}): ${tourName} on ${tourDateStr} (${participants}/${minimumRequired}, ${daysUntilTour}d left)`)
      }
    } else {
      // No OPEN alert at this stage -> create-or-update the row for this stage. The
      // upsert handles the case where a (possibly RESOLVED) row already exists for the
      // same tour_date_id + alert_stage, avoiding duplicate-key errors.
      const up = await upsertAlertRow(supabase, {
        tourDateId: tourDate.id,
        alertStage,
        activeParticipants: participants,
        minimumRequired,
        daysBeforeTour: daysUntilTour,
        status: 'OPEN',
        nowIso,
      })

      if (up.error) {
        result.details.push(`Alert creation failed: ${tourName} on ${tourDateStr} - ${up.error}`)
        continue
      }
      result.details.push(
        up.created
          ? `Alert created: ${tourName} on ${tourDateStr} (${alertStage})`
          : `Alert reopened: ${tourName} on ${tourDateStr} (${alertStage}, ${participants}/${minimumRequired})`
      )

      isNewStage = true
      result.alertsCreated++
    }

    // G: Only create email logs when a NEW stage alert is created.
    if (isNewStage) {
      if (alertStage === 'LOW_PARTICIPANTS_7_DAYS' || alertStage === 'LOW_PARTICIPANTS_5_DAYS') {
        // Main operations email
        const mainEmailResult = await createPendingEmailLog(supabase, {
          emailType: alertStage,
          fromEmail: EMAIL_CONFIG.from,
          toEmail: EMAIL_CONFIG.operations,
          cc: EMAIL_CONFIG.cc_default,
          subject: `Low Participants Alert - ${tourName} - ${tourDateStr}`
        })

        if (mainEmailResult.skipped) {
          result.emailLogsSkipped++
        } else if (mainEmailResult.success) {
          result.emailLogsCreated++
        }

        // Get agent emails for active reservations on this tour date
        const { data: activeReservations } = await supabase
          .from('reservations')
          .select('id, agent_email')
          .eq('tour_date_id', tourDate.id)
          .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])
          .not('agent_email', 'is', null)

        // Create email logs for each unique agent
        const agentEmails = new Set<string>()
        for (const reservation of activeReservations || []) {
          if (reservation.agent_email && !agentEmails.has(reservation.agent_email)) {
            agentEmails.add(reservation.agent_email)

            const agentEmailResult = await createPendingEmailLog(supabase, {
              reservationId: reservation.id,
              emailType: alertStage,
              fromEmail: EMAIL_CONFIG.from,
              toEmail: reservation.agent_email,
              cc: EMAIL_CONFIG.cc_supplier,
              subject: `Low Participants Alert - ${tourName} - ${tourDateStr}`
            })

            if (agentEmailResult.skipped) {
              result.emailLogsSkipped++
            } else if (agentEmailResult.success) {
              result.emailLogsCreated++
            }
          }
        }
      } else if (alertStage === 'SUPPLIER_DECISION_REQUIRED_3_DAYS') {
        // Supplier decision required email
        const supplierEmailResult = await createPendingEmailLog(supabase, {
          emailType: alertStage,
          fromEmail: EMAIL_CONFIG.from,
          toEmail: EMAIL_CONFIG.supplier,
          cc: EMAIL_CONFIG.cc_supplier,
          subject: `Supplier Decision Required - Minimum Participants - ${tourName} - ${tourDateStr}`
        })

        if (supplierEmailResult.skipped) {
          result.emailLogsSkipped++
        } else if (supplierEmailResult.success) {
          result.emailLogsCreated++
        }
      }
    }
  }
  
  // Note: missing email logs for already-existing alerts are handled by the dedicated
  // "Repair Missing Email Logs" action. Per requirement G, the regular check only
  // creates email logs when a NEW alert stage is created (handled in the loop above).

  revalidatePath('/admin/minimum-participants')
  revalidatePath('/admin/alerts')
  return result
}

export interface RepairResult {
  success: boolean
  error?: string
  emailLogsCreated: number
  emailLogsSkipped: number
  details: string[]
}

export async function repairMissingEmailLogs(): Promise<RepairResult> {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'minimum_participants_action_access')) {
    return { success: false, error: 'Access denied', emailLogsCreated: 0, emailLogsSkipped: 0, details: [] }
  }
  const supabase = await createClient()
  
  const result: RepairResult = {
    success: true,
    emailLogsCreated: 0,
    emailLogsSkipped: 0,
    details: []
  }
  
  // Get all OPEN alerts
  const { data: openAlerts, error } = await supabase
    .from('minimum_participant_alerts')
    .select(`
      id,
      tour_date_id,
      alert_stage,
      active_participants,
      minimum_required,
      tour_date:tour_dates(
        id,
        tour_date,
        tour:tours(id, name)
      )
    `)
    .eq('status', 'OPEN')
  
  if (error) {
    return { ...result, success: false, error: error.message }
  }
  
  for (const alert of openAlerts || []) {
    const tourName = (alert.tour_date as any)?.tour?.name || 'Unknown Tour'
    const tourDateStr = (alert.tour_date as any)?.tour_date
    const alertStage = alert.alert_stage
    
    if (alertStage === 'LOW_PARTICIPANTS_7_DAYS' || alertStage === 'LOW_PARTICIPANTS_5_DAYS') {
      const mainEmailResult = await createPendingEmailLog(supabase, {
        emailType: alertStage,
        fromEmail: EMAIL_CONFIG.from,
        toEmail: EMAIL_CONFIG.operations,
        cc: EMAIL_CONFIG.cc_default,
        subject: `Low Participants Alert - ${tourName} - ${tourDateStr}`
      })
      
      if (mainEmailResult.skipped) {
        result.emailLogsSkipped++
        result.details.push(`Skipped (exists): ${tourName} on ${tourDateStr} - operations email`)
      } else if (mainEmailResult.success) {
        result.emailLogsCreated++
        result.details.push(`Created: ${tourName} on ${tourDateStr} - operations email`)
      }
      
      // Get agent emails for active reservations
      const { data: activeReservations } = await supabase
        .from('reservations')
        .select('id, agent_email')
        .eq('tour_date_id', alert.tour_date_id)
        .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])
        .not('agent_email', 'is', null)
      
      const agentEmails = new Set<string>()
      for (const reservation of activeReservations || []) {
        if (reservation.agent_email && !agentEmails.has(reservation.agent_email)) {
          agentEmails.add(reservation.agent_email)
          
          const agentEmailResult = await createPendingEmailLog(supabase, {
            reservationId: reservation.id,
            emailType: alertStage,
            fromEmail: EMAIL_CONFIG.from,
            toEmail: reservation.agent_email,
            cc: EMAIL_CONFIG.cc_supplier,
            subject: `Low Participants Alert - ${tourName} - ${tourDateStr}`
          })
          
          if (agentEmailResult.skipped) {
            result.emailLogsSkipped++
            result.details.push(`Skipped (exists): ${tourName} on ${tourDateStr} - agent ${reservation.agent_email}`)
          } else if (agentEmailResult.success) {
            result.emailLogsCreated++
            result.details.push(`Created: ${tourName} on ${tourDateStr} - agent ${reservation.agent_email}`)
          }
        }
      }
      
    } else if (alertStage === 'SUPPLIER_DECISION_REQUIRED_3_DAYS') {
      const supplierEmailResult = await createPendingEmailLog(supabase, {
        emailType: alertStage,
        fromEmail: EMAIL_CONFIG.from,
        toEmail: EMAIL_CONFIG.supplier,
        cc: EMAIL_CONFIG.cc_supplier,
        subject: `Supplier Decision Required - Minimum Participants - ${tourName} - ${tourDateStr}`
      })
      
      if (supplierEmailResult.skipped) {
        result.emailLogsSkipped++
        result.details.push(`Skipped (exists): ${tourName} on ${tourDateStr} - supplier email`)
      } else if (supplierEmailResult.success) {
        result.emailLogsCreated++
        result.details.push(`Created: ${tourName} on ${tourDateStr} - supplier email`)
      }
    }
  }
  
  revalidatePath('/admin/minimum-participants')
  revalidatePath('/admin/email-logs')
  return result
}

// ---------------------------------------------------------------------------
// Live, automatic minimum-participants sync
//
// These helpers keep minimum_participant_alerts in sync with the CURRENT state
// of reservations and tour_dates for a SINGLE tour date. They are invoked
// automatically after any booking/reservation/availability change so the
// admin page always reflects live data without a manual check. The work is
// always scoped to one tour_date_id — it never scans all reservations.
// ---------------------------------------------------------------------------

const MIN_PARTICIPANTS_REQUIRED = 4

// Create the PENDING email logs that correspond to a newly-created alert stage.
// Shared so the manual check and the automatic sync stay consistent.
async function createStageEmailLogs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: { tourDateId: string; alertStage: string; tourName: string; tourDateStr: string }
): Promise<{ created: number; skipped: number; details: string[] }> {
  const { tourDateId, alertStage, tourName, tourDateStr } = params
  const out = { created: 0, skipped: 0, details: [] as string[] }

  if (alertStage === 'LOW_PARTICIPANTS_7_DAYS' || alertStage === 'LOW_PARTICIPANTS_5_DAYS') {
    const mainEmailResult = await createPendingEmailLog(supabase, {
      emailType: alertStage,
      fromEmail: EMAIL_CONFIG.from,
      toEmail: EMAIL_CONFIG.operations,
      cc: EMAIL_CONFIG.cc_default,
      subject: `Low Participants Alert - ${tourName} - ${tourDateStr}`
    })
    if (mainEmailResult.skipped) out.skipped++
    else if (mainEmailResult.success) out.created++

    // Notify each unique agent that has an active reservation on this date.
    const { data: activeReservations } = await supabase
      .from('reservations')
      .select('id, agent_email')
      .eq('tour_date_id', tourDateId)
      .in('status', ['WAITING FOR CONFIRMATION', 'CONFIRMED'])
      .not('agent_email', 'is', null)

    const agentEmails = new Set<string>()
    for (const reservation of activeReservations || []) {
      if (reservation.agent_email && !agentEmails.has(reservation.agent_email)) {
        agentEmails.add(reservation.agent_email)
        const agentEmailResult = await createPendingEmailLog(supabase, {
          reservationId: reservation.id,
          emailType: alertStage,
          fromEmail: EMAIL_CONFIG.from,
          toEmail: reservation.agent_email,
          cc: EMAIL_CONFIG.cc_supplier,
          subject: `Low Participants Alert - ${tourName} - ${tourDateStr}`
        })
        if (agentEmailResult.skipped) out.skipped++
        else if (agentEmailResult.success) out.created++
      }
    }
  } else if (alertStage === 'SUPPLIER_DECISION_REQUIRED_3_DAYS') {
    const supplierEmailResult = await createPendingEmailLog(supabase, {
      emailType: alertStage,
      fromEmail: EMAIL_CONFIG.from,
      toEmail: EMAIL_CONFIG.supplier,
      cc: EMAIL_CONFIG.cc_supplier,
      subject: `Supplier Decision Required - Minimum Participants - ${tourName} - ${tourDateStr}`
    })
    if (supplierEmailResult.skipped) out.skipped++
    else if (supplierEmailResult.success) out.created++
  }

  return out
}

// Resolve every OPEN alert for a tour date (used when 4+ participants reached,
// the date was closed/cancelled, or the date is in the past).
async function resolveOpenAlerts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tourDateId: string,
  participants: number,
  days: number,
  nowIso: string
): Promise<number> {
  const { data: openToResolve } = await supabase
    .from('minimum_participant_alerts')
    .select('id')
    .eq('tour_date_id', tourDateId)
    .eq('status', 'OPEN')

  if (openToResolve && openToResolve.length > 0) {
    await supabase
      .from('minimum_participant_alerts')
      .update({
        status: 'RESOLVED',
        active_participants: participants,
        days_before_tour: days,
        updated_at: nowIso
      })
      .eq('tour_date_id', tourDateId)
      .eq('status', 'OPEN')
    return openToResolve.length
  }
  return 0
}

// Maintain exactly ONE OPEN alert per tour date at the CURRENT stage with live
// values. Collapses stale duplicate OPEN rows and reopens a prior alert if one
// exists. Returns whether this represents a NEW stage (so emails are created).
async function upsertOpenAlertForStage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    tourDateId: string
    alertStage: string
    participants: number
    days: number
    nowIso: string
  }
): Promise<{ isNewStage: boolean }> {
  const { tourDateId, alertStage, participants, days, nowIso } = params

  const { data: openAlerts } = await supabase
    .from('minimum_participant_alerts')
    .select('id, alert_stage')
    .eq('tour_date_id', tourDateId)
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false })

  if (openAlerts && openAlerts.length > 0) {
    const [current, ...duplicates] = openAlerts
    const previousStage = current.alert_stage

    // Resolve any extra OPEN rows for this tour date up front.
    if (duplicates.length > 0) {
      await supabase
        .from('minimum_participant_alerts')
        .update({ status: 'RESOLVED', updated_at: nowIso })
        .in('id', duplicates.map((d) => d.id))
    }

    if (previousStage === alertStage) {
      // Same stage: just refresh live values on the current row.
      await supabase
        .from('minimum_participant_alerts')
        .update({
          active_participants: participants,
          days_before_tour: days,
          updated_at: nowIso,
        })
        .eq('id', current.id)
      return { isNewStage: false }
    }

    // Stage changed. A row may already exist at the NEW stage (e.g. a prior RESOLVED
    // row), which would make changing current.alert_stage violate the unique key.
    // Detect it and reuse it instead of colliding.
    const { data: existingAtNewStage } = await supabase
      .from('minimum_participant_alerts')
      .select('id')
      .eq('tour_date_id', tourDateId)
      .eq('alert_stage', alertStage)
      .maybeSingle()

    if (existingAtNewStage && existingAtNewStage.id !== current.id) {
      // Promote the existing new-stage row to OPEN and resolve the old-stage row.
      await supabase
        .from('minimum_participant_alerts')
        .update({
          status: 'OPEN',
          active_participants: participants,
          days_before_tour: days,
          updated_at: nowIso,
        })
        .eq('id', existingAtNewStage.id)
      await supabase
        .from('minimum_participant_alerts')
        .update({ status: 'RESOLVED', updated_at: nowIso })
        .eq('id', current.id)
    } else {
      // Safe to move the current row to the new stage.
      await supabase
        .from('minimum_participant_alerts')
        .update({
          alert_stage: alertStage,
          active_participants: participants,
          days_before_tour: days,
          updated_at: nowIso,
        })
        .eq('id', current.id)
    }

    return { isNewStage: true }
  }

  // No OPEN alert -> create-or-update the row for this stage. The upsert keys on
  // tour_date_id + alert_stage, so an existing (e.g. RESOLVED) row for the same stage
  // is updated in place instead of triggering a duplicate-key error.
  const up = await upsertAlertRow(supabase, {
    tourDateId,
    alertStage,
    activeParticipants: participants,
    minimumRequired: MIN_PARTICIPANTS_REQUIRED,
    daysBeforeTour: days,
    status: 'OPEN',
    nowIso,
  })

  if (up.error) {
    console.error('[v0] Failed to create/update alert:', up.error)
    return { isNewStage: false }
  }
  return { isNewStage: true }
}

// Core single-tour-date sync. Operates only on the given tour date row.
async function syncTourDateInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tourDate: { id: string; tour_date: string; is_open: boolean; supplier_status: string | null; tour?: { name?: string } | { name?: string }[] | null }
): Promise<{ created: number; skipped: number; emailLogsCreated: number; emailLogsSkipped: number; details: string[] }> {
  const out = { created: 0, skipped: 0, emailLogsCreated: 0, emailLogsSkipped: 0, details: [] as string[] }
  const nowIso = new Date().toISOString()
  const tourRel = Array.isArray(tourDate.tour) ? tourDate.tour[0] : tourDate.tour
  const tourName = tourRel?.name || 'Unknown Tour'
  const tourDateStr = tourDate.tour_date

  // Live active participants (WAITING/CONFIRMED) and live days remaining.
  const participants = await getActiveParticipants(supabase, tourDate.id)
  const days = computeDaysBeforeTour(tourDate.tour_date)

  // Respect supplier decisions — never re-alert a KEPT or CANCELLED tour date.
  const { data: decided } = await supabase
    .from('minimum_participant_alerts')
    .select('id')
    .eq('tour_date_id', tourDate.id)
    .in('status', ['KEPT', 'CANCELLED'])
    .limit(1)
  if (decided && decided.length > 0) {
    out.details.push(`Skipped (supplier decision already made): ${tourName} on ${tourDateStr}`)
    return out
  }

  const upcoming = days >= 0
  const dateClosed = !tourDate.is_open || tourDate.supplier_status === 'CANCELLED'

  // Not an open minimum-participants issue -> resolve any OPEN alerts.
  // A date with 0 active participants is NOT an issue (rule 3: never 0/4), so it is
  // treated the same as "no issue" and any stale OPEN alert is resolved.
  if (participants < 1 || participants >= MIN_PARTICIPANTS_REQUIRED || !upcoming || dateClosed) {
    const resolved = await resolveOpenAlerts(supabase, tourDate.id, participants, days, nowIso)
    if (resolved > 0) {
      out.details.push(`Resolved ${resolved} alert(s): ${tourName} on ${tourDateStr} (${participants}/${MIN_PARTICIPANTS_REQUIRED})`)
    }
    return out
  }

  // Below minimum, upcoming, open -> determine current stage from live days.
  const alertStage = computeAlertStage(days)
  if (!alertStage) {
    // More than 7 days out: no stage applies yet.
    return out
  }

  const { isNewStage } = await upsertOpenAlertForStage(supabase, {
    tourDateId: tourDate.id,
    alertStage,
    participants,
    days,
    nowIso
  })

  if (isNewStage) {
    out.created++
    out.details.push(`Alert ${alertStage}: ${tourName} on ${tourDateStr} (${participants}/${MIN_PARTICIPANTS_REQUIRED}, ${days}d left)`)
    const emails = await createStageEmailLogs(supabase, { tourDateId: tourDate.id, alertStage, tourName, tourDateStr })
    out.emailLogsCreated += emails.created
    out.emailLogsSkipped += emails.skipped
  } else {
    out.skipped++
  }

  return out
}

// Public, lightweight helper. Call after any change that affects a single
// tour date's participant count or open/cancel state. Never throws to callers.
export async function syncMinimumParticipantsForTourDate(
  tourDateId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!tourDateId) return { success: false, error: 'Missing tourDateId' }
    const supabase = await createClient()
    const { data: td, error } = await supabase
      .from('tour_dates')
      .select('id, tour_date, is_open, supplier_status, tour:tours(id, name)')
      .eq('id', tourDateId)
      .single()
    if (error || !td) return { success: false, error: error?.message || 'Tour date not found' }

    await syncTourDateInternal(supabase, td as any)
    revalidatePath('/admin/minimum-participants')
    return { success: true }
  } catch (err) {
    console.error('[v0] syncMinimumParticipantsForTourDate failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'sync failed' }
  }
}

// Section 7: sync ONLY the tour dates currently visible on the page. Bounded to the
// provided ids — never scans the whole database / history.
export async function syncVisibleMinimumParticipantIssues(
  tourDateIds: string[]
): Promise<{ success: boolean; synced: number; error?: string }> {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'minimum_participants_action_access')) {
    return { success: false, synced: 0, error: 'Access denied' }
  }
  try {
    const ids = Array.from(new Set((tourDateIds || []).filter(Boolean)))
    if (ids.length === 0) return { success: true, synced: 0 }
    const supabase = await createClient()
    const { data: dates, error } = await supabase
      .from('tour_dates')
      .select('id, tour_date, is_open, supplier_status, tour:tours(id, name)')
      .in('id', ids)
      .limit(500)
    if (error) return { success: false, synced: 0, error: error.message }

    let synced = 0
    for (const td of dates || []) {
      await syncTourDateInternal(supabase, td as any)
      synced++
    }
    revalidatePath('/admin/minimum-participants')
    return { success: true, synced }
  } catch (err) {
    console.error('[v0] syncVisibleMinimumParticipantIssues failed:', err)
    return { success: false, synced: 0, error: err instanceof Error ? err.message : 'sync failed' }
  }
}

// Section 9: Cancel/Keep a tour starting from a tour_date_id. This handles LIVE
// issues that do not yet have a minimum_participant_alerts row: it creates/syncs the
// alert row first, then delegates to resolveAlert so cancellation emails are sent for
// every eligible reservation (eligible list is computed BEFORE statuses change).
export async function resolveAlertForTourDate(
  tourDateId: string,
  decision: 'KEEP_TOUR' | 'CANCEL_TOUR',
  notes?: string
) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'minimum_participants_action_access')) {
    return { success: false, error: 'Access denied' }
  }
  const supabase = await createClient()

  // Ensure an alert row exists for this tour date.
  const { data: td } = await supabase
    .from('tour_dates')
    .select('id, tour_date, is_open, supplier_status, tour:tours(id, name)')
    .eq('id', tourDateId)
    .single()
  if (td) {
    await syncTourDateInternal(supabase, td as any)
  }

  // Prefer the OPEN alert row that sync just maintained/created.
  let alertId: string | null = null
  const { data: openAlert } = await supabase
    .from('minimum_participant_alerts')
    .select('id')
    .eq('tour_date_id', tourDateId)
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  alertId = openAlert?.id || null

  // Sync may not create a row (e.g. more than 7 days out). Create-or-find one so the
  // cancel/keep action can still proceed. The upsert keys on tour_date_id +
  // alert_stage, so an existing row for that stage is reused instead of erroring.
  if (!alertId && td) {
    const days = computeDaysBeforeTour((td as any).tour_date)
    const stage = computeAlertStage(days) || 'SUPPLIER_DECISION_REQUIRED_3_DAYS'
    const active = await getActiveParticipants(supabase, tourDateId)
    const up = await upsertAlertRow(supabase, {
      tourDateId,
      alertStage: stage,
      activeParticipants: active,
      minimumRequired: MIN_PARTICIPANTS_REQUIRED,
      daysBeforeTour: days,
      status: 'OPEN',
    })
    if (up.error) {
      return { success: false, error: `Could not create alert row: ${up.error}` }
    }
    alertId = up.id
  }

  if (!alertId) {
    return { success: false, error: 'Could not resolve an alert row for this tour date' }
  }

  return resolveAlert(alertId, decision, notes)
}

// Part C: manual-safe stage refresh. Scans ONLY upcoming open tour dates within
// the next 7 days (the window where stages apply) and syncs each one. Bounded
// and safe to run on demand; not run automatically on page load.
export async function refreshMinimumParticipantStages(): Promise<CheckResult> {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'minimum_participants_action_access')) {
    return { success: false, error: 'Access denied', alertsCreated: 0, alertsSkipped: 0, emailLogsCreated: 0, emailLogsSkipped: 0, details: [] }
  }
  const result: CheckResult = {
    success: true,
    alertsCreated: 0,
    alertsSkipped: 0,
    emailLogsCreated: 0,
    emailLogsSkipped: 0,
    details: []
  }

  try {
    const supabase = await createClient()
    const today = new Date()
    const sevenDaysFromNow = new Date(today)
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)

    const { data: upcomingDates, error } = await supabase
      .from('tour_dates')
      .select('id, tour_date, supplier_status, is_open, tour:tours(id, name)')
      .gte('tour_date', today.toISOString().split('T')[0])
      .lte('tour_date', sevenDaysFromNow.toISOString().split('T')[0])
      .eq('is_open', true)
      .not('supplier_status', 'eq', 'CANCELLED')
      .order('tour_date', { ascending: true })
      .limit(200)

    if (error) {
      return { ...result, success: false, error: error.message }
    }

    for (const td of upcomingDates || []) {
      const r = await syncTourDateInternal(supabase, td as any)
      result.alertsCreated += r.created
      result.alertsSkipped += r.skipped
      result.emailLogsCreated += r.emailLogsCreated
      result.emailLogsSkipped += r.emailLogsSkipped
      result.details.push(...r.details)
    }

    revalidatePath('/admin/minimum-participants')
    revalidatePath('/admin/email-logs')
    return result
  } catch (err) {
    console.error('[v0] refreshMinimumParticipantStages failed:', err)
    return { ...result, success: false, error: err instanceof Error ? err.message : 'refresh failed' }
  }
}
