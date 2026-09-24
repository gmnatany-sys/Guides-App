'use server'
import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission } from '@/lib/authorization'
import { processEmailOutbox } from '@/lib/email-log'
import type { CriticalEmailType, SafetyCheckResult, CreateMissingResult } from './types'
export async function fetchEmailLogs(offset = 0) {
  await requirePermission('email_logs_view_access')
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid page.')
  const t0 = Date.now()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('email_logs')
    .select('*, reservations(voucher_number, reservation_number)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + 49)

  console.log(`[v0] pageData route=/admin/email-logs step=fetchEmailLogs duration=${Date.now() - t0}ms`)

  if (error) {
    return { emailLogs: [], error: error.message }
  }

  return { emailLogs: data || [], error: null }
}

export async function getPendingEmailCount() {
  await requirePermission('email_logs_view_access')
  const t0 = Date.now()
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('email_logs')
    .select('status', { count: 'exact', head: true })
    .in('status', ['PENDING', 'READY_TO_SEND'])

  console.log(`[v0] pageData route=/admin/email-logs step=getPendingEmailCount duration=${Date.now() - t0}ms`)

  if (error) {
    return { count: 0, error: error.message }
  }

  return { count: count || 0, error: null }
}

function getRequiredEmailTypes(reservationStatus: string): CriticalEmailType[] {
  const required: CriticalEmailType[] = ['NEW_BOOKING']
  if (reservationStatus === 'CONFIRMED') required.push('CONFIRMED')
  if (reservationStatus === 'NOT CONFIRMED') required.push('NOT_CONFIRMED')
  if (reservationStatus === 'CANCELLED') required.push('CANCELLED')
  return required
}

export async function checkMissingCriticalEmails(): Promise<SafetyCheckResult> {
  await requirePermission('email_logs_view_access')
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
      const covered = statuses && statuses.size > 0
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
export async function sendPendingEmailLogs(testMode = false) {
  await requirePermission('email_logs_manage_access')
  const result = await processEmailOutbox({dryRun:testMode})
  return {...result, message:testMode ? 'Dry run complete. No emails were sent.' : `Sent ${result.sent}; ${result.failed} require follow-up.`}
}
export async function retryFailedEmails() {
  await requirePermission('email_logs_manage_access')
  return processEmailOutbox({failedOnly:true})
}
export async function createAndSendMissingEmails(): Promise<CreateMissingResult> {
  await requirePermission('email_logs_manage_access')
  const check = await checkMissingCriticalEmails()
  const result: CreateMissingResult = {success:check.success,error:check.error,created:0,sentPending:0,retriedFailed:0,failed:0,skipped:0,details:[]}
  if (!check.success) return result
  for (const item of check.missing) {
    const {error} = await createClient().rpc('booking_queue_email',{p_reservation:item.reservationId,p_type:item.missingEmailType})
    if(error) {result.failed++;result.details.push(error.message)} else result.created++
  }
  const delivery = await processEmailOutbox()
  result.sentPending=delivery.sent;result.failed+=delivery.failed;result.success=result.failed===0
  return result
}
