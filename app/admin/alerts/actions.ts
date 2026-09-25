'use server'
import { requirePermission } from '@/lib/authorization'
import { getServiceRoleClient } from '@/lib/supabase-admin'
import { assertDateAccess } from '@/lib/guide-access'
import * as core from '@/lib/minimum-participants'

export async function fetchMinimumParticipantAlerts(filters?: {status?:string;alert_stage?:string}) {
  const actor = await requirePermission("minimum_participants_view_access","reservations_view_access","supplier_confirmation_view")
  return core.fetchMinimumParticipantAlerts(filters, actor.role === 'supplier' ? actor.id : undefined)
}

export async function fetchMinimumParticipantHistory() {
  const actor = await requirePermission("minimum_participants_view_access","reservations_view_access","supplier_confirmation_view")
  return core.fetchMinimumParticipantHistory(actor.role === 'supplier' ? actor.id : undefined)
}

export async function fetchMinimumParticipantCandidates() {
  const actor = await requirePermission("minimum_participants_view_access","reservations_view_access","supplier_confirmation_view")
  return core.fetchMinimumParticipantCandidates(actor.role === 'supplier' ? actor.id : undefined)
}

export async function resolveAlert(...args: Parameters<typeof core.resolveAlert>) {
  await requirePermission("minimum_participants_action_access")
  return core.resolveAlert(...args)
}

export async function repairMissingCancellationEmails(...args: Parameters<typeof core.repairMissingCancellationEmails>) {
  await requirePermission("email_logs_manage_access")
  return core.repairMissingCancellationEmails(...args)
}

export async function debugCancellationEmails(...args: Parameters<typeof core.debugCancellationEmails>) {
  await requirePermission("email_logs_view_access")
  return core.debugCancellationEmails(...args)
}

export async function sendMissingCancellationEmail(...args: Parameters<typeof core.sendMissingCancellationEmail>) {
  await requirePermission("email_logs_manage_access")
  return core.sendMissingCancellationEmail(...args)
}

export async function checkAndCreateAlerts(): Promise<core.CheckResult> {
  const actor = await requirePermission('minimum_participants_action_access')
  const {data,error} = await getServiceRoleClient().rpc('booking_check_guide_minimum',{p_actor:actor.id})
  if(error || !data) return {success:false,error:error?.message ?? 'Check failed.',alertsCreated:0,alertsSkipped:0,emailLogsCreated:0,emailLogsSkipped:0,details:[]}
  return data
}

export async function repairMissingEmailLogs(...args: Parameters<typeof core.repairMissingEmailLogs>) {
  await requirePermission("email_logs_manage_access")
  return core.repairMissingEmailLogs(...args)
}

export async function syncMinimumParticipantsForTourDate(...args: Parameters<typeof core.syncMinimumParticipantsForTourDate>) {
  const actor = await requirePermission("minimum_participants_action_access")
  await assertDateAccess(actor, [args[0]])
  return core.syncMinimumParticipantsForTourDate(...args)
}

export async function syncVisibleMinimumParticipantIssues(...args: Parameters<typeof core.syncVisibleMinimumParticipantIssues>) {
  const actor = await requirePermission("minimum_participants_action_access")
  await assertDateAccess(actor, args[0])
  return core.syncVisibleMinimumParticipantIssues(...args)
}

export async function resolveAlertForTourDate(...args: Parameters<typeof core.resolveAlertForTourDate>) {
  const actor = await requirePermission("minimum_participants_action_access")
  await assertDateAccess(actor, [args[0]])
  return core.resolveAlertForTourDate(...args)
}

export async function refreshMinimumParticipantStages(): Promise<core.CheckResult> {
  const actor = await requirePermission('minimum_participants_action_access')
  const {data,error} = await getServiceRoleClient().rpc('booking_check_guide_minimum',{p_actor:actor.id})
  if(error || !data) return {success:false,error:error?.message ?? 'Check failed.',alertsCreated:0,alertsSkipped:0,emailLogsCreated:0,emailLogsSkipped:0,details:[]}
  return data
}

export type { MinimumParticipantAlert, CheckResult, CancellationEmailDetail, CancellationResult, MinimumParticipantCandidate, CancellationDebugReservation, CancellationDebugAlert, CancellationDebugResult, RepairResult } from '@/lib/minimum-participants'
