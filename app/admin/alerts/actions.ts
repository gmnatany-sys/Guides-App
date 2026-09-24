'use server'
import { requirePermission } from '@/lib/authorization'
import * as core from '@/lib/minimum-participants'

export async function fetchMinimumParticipantAlerts(...args: Parameters<typeof core.fetchMinimumParticipantAlerts>) {
  await requirePermission("minimum_participants_view_access","reservations_view_access","supplier_confirmation_view")
  return core.fetchMinimumParticipantAlerts(...args)
}

export async function fetchMinimumParticipantHistory(...args: Parameters<typeof core.fetchMinimumParticipantHistory>) {
  await requirePermission("minimum_participants_view_access","reservations_view_access","supplier_confirmation_view")
  return core.fetchMinimumParticipantHistory(...args)
}

export async function fetchMinimumParticipantCandidates(...args: Parameters<typeof core.fetchMinimumParticipantCandidates>) {
  await requirePermission("minimum_participants_view_access","reservations_view_access","supplier_confirmation_view")
  return core.fetchMinimumParticipantCandidates(...args)
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

export async function checkAndCreateAlerts(...args: Parameters<typeof core.checkAndCreateAlerts>) {
  await requirePermission("minimum_participants_action_access")
  return core.checkAndCreateAlerts(...args)
}

export async function repairMissingEmailLogs(...args: Parameters<typeof core.repairMissingEmailLogs>) {
  await requirePermission("email_logs_manage_access")
  return core.repairMissingEmailLogs(...args)
}

export async function syncMinimumParticipantsForTourDate(...args: Parameters<typeof core.syncMinimumParticipantsForTourDate>) {
  await requirePermission("minimum_participants_action_access")
  return core.syncMinimumParticipantsForTourDate(...args)
}

export async function syncVisibleMinimumParticipantIssues(...args: Parameters<typeof core.syncVisibleMinimumParticipantIssues>) {
  await requirePermission("minimum_participants_action_access")
  return core.syncVisibleMinimumParticipantIssues(...args)
}

export async function resolveAlertForTourDate(...args: Parameters<typeof core.resolveAlertForTourDate>) {
  await requirePermission("minimum_participants_action_access")
  return core.resolveAlertForTourDate(...args)
}

export async function refreshMinimumParticipantStages(...args: Parameters<typeof core.refreshMinimumParticipantStages>) {
  await requirePermission("minimum_participants_action_access")
  return core.refreshMinimumParticipantStages(...args)
}

export type { MinimumParticipantAlert, CheckResult, CancellationEmailDetail, CancellationResult, MinimumParticipantCandidate, CancellationDebugReservation, CancellationDebugAlert, CancellationDebugResult, RepairResult } from '@/lib/minimum-participants'
