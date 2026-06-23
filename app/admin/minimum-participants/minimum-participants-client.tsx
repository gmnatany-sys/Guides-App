'use client'

import { useState, useEffect, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { 
  fetchMinimumParticipantAlerts,
  fetchMinimumParticipantHistory,
  fetchMinimumParticipantCandidates,
  resolveAlert,
  resolveAlertForTourDate,
  syncVisibleMinimumParticipantIssues,
  checkAndCreateAlerts,
  refreshMinimumParticipantStages,
  repairMissingEmailLogs,
  repairMissingCancellationEmails,
  debugCancellationEmails,
  sendMissingCancellationEmail,
  type MinimumParticipantAlert,
  type CheckResult,
  type RepairResult,
  type CancellationResult,
  type CancellationDebugResult,
  type CancellationDebugReservation,
  type MinimumParticipantCandidate
} from '../alerts/actions'

// Client-only date formatter to avoid hydration mismatch
function FormattedDate({ dateString }: { dateString: string }) {
  const [formatted, setFormatted] = useState<string>('')
  
  useEffect(() => {
    if (dateString) {
      setFormatted(new Date(dateString).toLocaleDateString('en-US', { 
        weekday: 'short', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      }))
    }
  }, [dateString])
  
  if (!formatted) return null
  return <>{formatted}</>
}

// Live calendar-day difference between today and the tour date, computed in LOCAL
// time so it matches the user's calendar (e.g. if today is June 11: June 11 = 0,
// June 14 = 3, June 17 = 6). Parsed at local midnight to avoid UTC off-by-one.
function computeDaysLeft(tourDate: string): number {
  if (!tourDate) return 0
  const datePart = tourDate.split('T')[0]
  const [y, m, d] = datePart.split('-').map(Number)
  const target = new Date(y, (m || 1) - 1, d || 1)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// Live alert stage derived from the live days left.
// <=3 => decision required, 4-5 => 5-day warning, otherwise => 7-day warning.
function computeLiveStage(daysLeft: number): string {
  if (daysLeft <= 3) return 'SUPPLIER_DECISION_REQUIRED_3_DAYS'
  if (daysLeft <= 5) return 'LOW_PARTICIPANTS_5_DAYS'
  return 'LOW_PARTICIPANTS_7_DAYS'
}

// Badge label reflects the ACTUAL days_left, while colors follow the same logic
// groups: 6-7 = early warning (yellow), 4-5 = warning (orange), 0-3 = decision
// required (destructive).
function getAlertStageBadge(daysLeft: number) {
  if (daysLeft <= 3) {
    const label = daysLeft <= 0 ? 'Today - Decision Required' : `${daysLeft} Day${daysLeft === 1 ? '' : 's'} - Decision Required`
    return <Badge variant="destructive">{label}</Badge>
  }
  if (daysLeft <= 5) {
    return <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">{daysLeft} Days Warning</Badge>
  }
  return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">{daysLeft} Days Warning</Badge>
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'OPEN':
      return <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">Open</Badge>
    case 'RESOLVED':
      return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">Resolved</Badge>
    case 'CANCELLED':
      return <Badge variant="destructive">Cancelled</Badge>
    case 'KEPT':
      return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">Kept</Badge>
    case 'NOT CREATED':
      return <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">Not Created</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function getDecisionBadge(decision: string | null) {
  if (!decision) return <span className="text-muted-foreground">-</span>
  switch (decision) {
    case 'KEEP_TOUR':
      return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">Keep Tour</Badge>
    case 'CANCEL_TOUR':
      return <Badge variant="destructive">Cancel Tour</Badge>
    default:
      return <Badge variant="outline">{decision}</Badge>
  }
}

export default function MinimumParticipantsClient({ canAct }: { canAct: boolean }) {
  const [alerts, setAlerts] = useState<MinimumParticipantAlert[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  // Filters
  const [stageFilter, setStageFilter] = useState<string>('all')
  
  // Decision dialog
  const [decidingAlert, setDecidingAlert] = useState<MinimumParticipantAlert | null>(null)
  const [decisionType, setDecisionType] = useState<'KEEP_TOUR' | 'CANCEL_TOUR' | null>(null)
  const [decisionNotes, setDecisionNotes] = useState('')
  
  // Check status
  const [isChecking, setIsChecking] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  // Primary daily-operations refresh (safe sync + stage refresh + reload)
  const [isPrimaryRefreshing, setIsPrimaryRefreshing] = useState(false)
  // Advanced/maintenance tools are collapsed by default for daily users.
  const [showAdvancedTools, setShowAdvancedTools] = useState(false)
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)
  
  // Repair status
  const [isRepairing, setIsRepairing] = useState(false)
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null)

  // Cancellation diagnostics (debug panel) + per-alert email repair
  const [cancellationResult, setCancellationResult] = useState<CancellationResult | null>(null)
  const [repairingAlertId, setRepairingAlertId] = useState<string | null>(null)

  // Debug Cancellation Emails: full per-reservation diagnostics
  const [isDebugging, setIsDebugging] = useState(false)
  const [debugResult, setDebugResult] = useState<CancellationDebugResult | null>(null)
  const [showOnlyMissingFailed, setShowOnlyMissingFailed] = useState(false)
  const [sendingReservationId, setSendingReservationId] = useState<string | null>(null)

  // Past / Resolved history (collapsed, loaded on demand only)
  const [showHistory, setShowHistory] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [historyAlerts, setHistoryAlerts] = useState<MinimumParticipantAlert[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Debug Visible Candidate Dates (collapsed, loaded on demand only)
  const [showCandidates, setShowCandidates] = useState(false)
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false)
  const [candidates, setCandidates] = useState<MinimumParticipantCandidate[]>([])

  async function loadAlerts() {
    setIsLoading(true)
    try {
      const { alerts: data, error } = await fetchMinimumParticipantAlerts({
        alert_stage: stageFilter !== 'all' ? stageFilter : undefined
      })
      if (error) {
        setMessage({ type: 'error', text: error })
      } else {
        setAlerts(data)
      }
    } catch (err) {
      console.error('[v0] minimum-participants loadAlerts failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load alerts.' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [stageFilter])

  async function loadHistory() {
    setIsLoadingHistory(true)
    try {
      const { alerts: data, error } = await fetchMinimumParticipantHistory()
      if (error) {
        setMessage({ type: 'error', text: error })
      } else {
        setHistoryAlerts(data)
        setHistoryLoaded(true)
      }
    } catch (err) {
      console.error('[v0] loadHistory failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load history.' })
    } finally {
      setIsLoadingHistory(false)
    }
  }

  // Rule 15: history is fetched only when the section is first expanded.
  function handleToggleHistory() {
    const next = !showHistory
    setShowHistory(next)
    if (next && !historyLoaded) {
      loadHistory()
    }
  }

  // Item 9: Debug Visible Candidate Dates — always re-fetched on expand so the
  // diagnostics reflect the current live state.
  async function handleToggleCandidates() {
    const next = !showCandidates
    setShowCandidates(next)
    if (next) {
      setIsLoadingCandidates(true)
      try {
        const { candidates: data, error } = await fetchMinimumParticipantCandidates()
        if (error) {
          setMessage({ type: 'error', text: error })
        } else {
          setCandidates(data)
        }
      } catch (err) {
        console.error('[v0] loadCandidates failed:', err)
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load candidates.' })
      } finally {
        setIsLoadingCandidates(false)
      }
    }
  }

  async function handleRunCheck() {
    setIsChecking(true)
    setMessage(null)
    setCheckResult(null)
    setRepairResult(null)
    setShowTechnicalDetails(false)
    try {
      const result = await checkAndCreateAlerts()
      setCheckResult(result)
      if (result.success) {
        setMessage({ type: 'success', text: 'Check completed successfully.' })
        await loadAlerts()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to run check' })
      }
    } catch (err) {
      console.error('[v0] handleRunCheck failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to run check' })
    } finally {
      setIsChecking(false)
    }
  }

  // Primary daily-operations action: the normal safe refresh for the current
  // operational window. Recalculates live issues, syncs the visible issues, refreshes
  // stages, and reloads the page — without exposing any debug/maintenance tooling.
  async function handleRefreshMinimumParticipants() {
    setIsPrimaryRefreshing(true)
    setMessage(null)
    setCheckResult(null)
    setRepairResult(null)
    setShowTechnicalDetails(false)
    try {
      // 1) Recalculate the current live issues from the DB.
      const { alerts: fresh, error: fetchError } = await fetchMinimumParticipantAlerts({
        alert_stage: stageFilter !== 'all' ? stageFilter : undefined,
      })
      if (fetchError) {
        setMessage({ type: 'error', text: fetchError })
        return
      }
      setAlerts(fresh)

      // 2) Sync the visible issues so DB rows match the live state.
      const ids = Array.from(new Set(fresh.map((a) => a.tour_date_id)))
      if (ids.length > 0) {
        await syncVisibleMinimumParticipantIssues(ids)
      }

      // 3) Refresh stages for the current visible window.
      await refreshMinimumParticipantStages()

      // 4) Reload so the page reflects the synced state.
      await loadAlerts()
      setMessage({ type: 'success', text: 'Minimum participants refreshed.' })
    } catch (err) {
      console.error('[v0] handleRefreshMinimumParticipants failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to refresh' })
    } finally {
      setIsPrimaryRefreshing(false)
    }
  }

  async function handleRefreshStages() {
    setIsRefreshing(true)
    setMessage(null)
    setCheckResult(null)
    setRepairResult(null)
    setShowTechnicalDetails(false)
    try {
      const result = await refreshMinimumParticipantStages()
      setCheckResult(result)
      if (result.success) {
        setMessage({ type: 'success', text: 'Stages refreshed with live data.' })
        await loadAlerts()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to refresh stages' })
      }
    } catch (err) {
      console.error('[v0] handleRefreshStages failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to refresh stages' })
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleSyncVisible() {
    setIsSyncing(true)
    setMessage(null)
    setCheckResult(null)
    setRepairResult(null)
    setShowTechnicalDetails(false)
    try {
      const ids = Array.from(new Set(displayAlerts.map((r) => r.alert.tour_date_id)))
      const result = await syncVisibleMinimumParticipantIssues(ids)
      if (result.success) {
        setMessage({ type: 'success', text: `Synced ${result.synced} visible issues.` })
        await loadAlerts()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to sync visible issues' })
      }
    } catch (err) {
      console.error('[v0] handleSyncVisible failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to sync visible issues' })
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleRepairEmailLogs() {
    setIsRepairing(true)
    setMessage(null)
    setRepairResult(null)
    setCheckResult(null)
    setShowTechnicalDetails(false)
    try {
      const result = await repairMissingEmailLogs()
      setRepairResult(result)
      if (result.success) {
        setMessage({
          type: 'success',
          text: `Repair completed. ${result.emailLogsCreated} email logs created, ${result.emailLogsSkipped} skipped.`
        })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to repair email logs' })
      }
    } catch (err) {
      console.error('[v0] handleRepairEmailLogs failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to repair email logs' })
    } finally {
      setIsRepairing(false)
    }
  }

  async function handleDecision() {
    if (!decidingAlert || !decisionType) return
    const isCancel = decisionType === 'CANCEL_TOUR'

    startTransition(async () => {
      try {
        setCancellationResult(null)
        // Live issues (no alert row yet) use a synthetic id `live:<tourDateId>`.
        // For those, create/sync the alert row first, then process the decision.
        const isLiveIssue = decidingAlert.id.startsWith('live:') || decidingAlert.status === 'NOT CREATED'
        const result = isLiveIssue
          ? await resolveAlertForTourDate(decidingAlert.tour_date_id, decisionType, decisionNotes)
          : await resolveAlert(decidingAlert.id, decisionType, decisionNotes)
        if (result.success) {
          // For a cancellation, surface the full per-reservation diagnostics panel.
          if (isCancel && 'details' in result) {
            const cr = result as CancellationResult
            setCancellationResult(cr)
            setMessage({
              type: cr.emailsFailed > 0 ? 'error' : 'success',
              text: cr.message || 'Tour cancelled.'
            })
          } else {
            const text = (result as any).message || 'Tour kept successfully.'
            setMessage({ type: 'success', text })
          }
          setDecidingAlert(null)
          setDecisionType(null)
          setDecisionNotes('')
          loadAlerts()
        } else {
          setMessage({ type: 'error', text: result.error || 'Failed to process decision' })
        }
      } catch (err) {
        console.error('[v0] handleDecision failed:', err)
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to process decision' })
      }
    })
  }

  async function handleRepairAlert(alertId: string) {
    setRepairingAlertId(alertId)
    setMessage(null)
    setCancellationResult(null)
    try {
      const result = await repairMissingCancellationEmails(alertId)
      setCancellationResult(result)
      setMessage({
        type: result.success && result.emailsFailed === 0 ? 'success' : 'error',
        text: result.error || result.message || 'Repair complete.'
      })
      loadAlerts()
    } catch (err) {
      console.error('[v0] handleRepairAlert failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to repair cancellation emails' })
    } finally {
      setRepairingAlertId(null)
    }
  }

  function openDecisionDialog(alert: MinimumParticipantAlert, decision: 'KEEP_TOUR' | 'CANCEL_TOUR') {
    setDecidingAlert(alert)
    setDecisionType(decision)
    setDecisionNotes('')
  }

  async function handleDebugCancellationEmails() {
    setIsDebugging(true)
    setMessage(null)
    try {
      const result = await debugCancellationEmails()
      setDebugResult(result)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || 'Failed to run debug' })
      }
    } catch (err) {
      console.error('[v0] handleDebugCancellationEmails failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to run debug' })
    } finally {
      setIsDebugging(false)
    }
  }

  async function handleSendMissing(reservationId: string) {
    setSendingReservationId(reservationId)
    setMessage(null)
    try {
      const detail = await sendMissingCancellationEmail(reservationId)
      if (detail.email_sent) {
        setMessage({ type: 'success', text: `Cancellation email sent for voucher ${detail.voucher_number}.` })
      } else if (detail.skipped_duplicate) {
        setMessage({ type: 'success', text: `Skipped voucher ${detail.voucher_number}: a SENT email already exists.` })
      } else {
        setMessage({ type: 'error', text: `Failed to send for voucher ${detail.voucher_number}: ${detail.error || 'Unknown error'}` })
      }
      // Refresh the debug report so the row reflects the new state.
      await handleDebugCancellationEmails()
    } catch (err) {
      console.error('[v0] handleSendMissing failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send cancellation email' })
    } finally {
      setSendingReservationId(null)
    }
  }

  // Build the display list using LIVE calculated values. For OPEN alerts we always
  // recompute days left and alert stage from the current date + tour_date, ignoring
  // any stale stored values. Decided/historical rows keep their stored values.
  const displayAlerts = alerts
    .map((a) => {
      const tourDateStr = (a.tour_date as any)?.tour_date as string | undefined
      // A row is "live" when it is an active issue: an OPEN alert OR a calculated
      // live issue that has no alert row yet ('NOT CREATED').
      const isLive = a.status === 'OPEN' || a.status === 'NOT CREATED'
      // Rule 6: days_left is ALWAYS computed live from the tour date, never the stale
      // stored days_before_tour value.
      const liveDays = tourDateStr ? computeDaysLeft(tourDateStr) : a.days_before_tour
      // Only live rows get a recomputed alert stage; decided/resolved rows keep their
      // stored stage and never display a fresh "Decision Required" warning.
      const liveStage = isLive ? computeLiveStage(liveDays) : a.alert_stage
      return { alert: a, isLive, liveDays, liveStage }
    })
    // Any row whose tour date has passed (days left < 0) must not appear — this
    // applies to both live issues and decided (KEPT/CANCELLED) rows.
    .filter((row) => row.liveDays >= 0)

  // Summary stats (live)
  const openAlerts = displayAlerts.filter((r) => r.isLive).length
  const decisionRequired = displayAlerts.filter(
    (r) => r.isLive && r.liveStage === 'SUPPLIER_DECISION_REQUIRED_3_DAYS'
  ).length

  return (
    <div className="w-full space-y-6">
      {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Minimum Participants</h1>
            <p className="text-muted-foreground">
              Monitor tour dates with fewer than 4 active participants and make supplier decisions.
            </p>
          </div>
          {canAct && (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleRefreshMinimumParticipants}
                disabled={isPrimaryRefreshing || isSyncing || isRefreshing || isChecking || isRepairing}
              >
                {isPrimaryRefreshing ? 'Refreshing...' : 'Refresh Minimum Participants'}
              </Button>
            </div>
          )}
        </div>

        {/* Advanced tools: debug/maintenance only, collapsed by default — hidden for view-only users */}
        {canAct && <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Advanced tools</CardTitle>
                <CardDescription>
                  These tools are for debugging and maintenance only.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdvancedTools((v) => !v)}
              >
                {showAdvancedTools ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          {showAdvancedTools && (
            <CardContent>
              <p className="text-sm text-amber-600 mb-4">
                These tools are for debugging and maintenance only.
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Technical details: an alert is raised for tour dates with fewer than 4 active
                participants, where active means status WAITING FOR CONFIRMATION or CONFIRMED.
                Days left and alert stage are calculated live from today&apos;s date.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleSyncVisible}
                  disabled={isSyncing || isRefreshing || isChecking || isRepairing || isPrimaryRefreshing}
                >
                  {isSyncing ? 'Syncing...' : 'Sync Visible Issues'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRefreshStages}
                  disabled={isRefreshing || isChecking || isRepairing || isPrimaryRefreshing}
                >
                  {isRefreshing ? 'Refreshing...' : 'Refresh Stages'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRepairEmailLogs}
                  disabled={isRepairing || isChecking || isRefreshing || isPrimaryRefreshing}
                >
                  {isRepairing ? 'Repairing...' : 'Repair Missing Email Logs'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDebugCancellationEmails}
                  disabled={isDebugging || isChecking || isRepairing || isRefreshing || isPrimaryRefreshing}
                >
                  {isDebugging ? 'Debugging...' : 'Debug Cancellation Emails'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRunCheck}
                  disabled={isChecking || isRepairing || isRefreshing || isPrimaryRefreshing}
                >
                  {isChecking ? 'Checking...' : 'Run Minimum Participants Check'}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>}

        {/* Message */}
        {message && (
          <div className={`p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {message.text}
          </div>
        )}

        {/* Minimum Participants Cancellation Result (debug panel) */}
        {cancellationResult && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Minimum Participants Cancellation Result</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setCancellationResult(null)}>Dismiss</Button>
              </div>
              <CardDescription>Per-reservation outcome for the most recent cancellation / repair.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Reservations Cancelled</div>
                  <div className="text-2xl font-bold">{cancellationResult.reservationsCancelled}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Emails Sent</div>
                  <div className="text-2xl font-bold text-green-600">{cancellationResult.emailsSent}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Emails Failed</div>
                  <div className={`text-2xl font-bold ${cancellationResult.emailsFailed > 0 ? 'text-red-600' : ''}`}>{cancellationResult.emailsFailed}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Skipped (Duplicate)</div>
                  <div className="text-2xl font-bold text-amber-600">{cancellationResult.emailsSkippedDuplicate}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Active Found</div>
                  <div className="text-2xl font-bold">{cancellationResult.activeReservationsFound}</div>
                </div>
              </div>

              {cancellationResult.details.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Prev → New</TableHead>
                      <TableHead>Agent Email</TableHead>
                      <TableHead>Log</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Duplicate</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cancellationResult.details.map((d) => (
                      <TableRow key={d.reservation_id}>
                        <TableCell className="font-medium">{d.voucher_number}</TableCell>
                        <TableCell className="text-sm">{d.previous_status} → {d.new_status}</TableCell>
                        <TableCell className="text-sm">{d.agent_email || '-'}</TableCell>
                        <TableCell>{d.email_log_created ? 'Yes' : 'No'}</TableCell>
                        <TableCell>
                          {d.email_sent
                            ? <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">Sent</Badge>
                            : d.skipped_duplicate
                              ? <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">Skipped</Badge>
                              : <Badge variant="destructive">Failed</Badge>}
                        </TableCell>
                        <TableCell>{d.skipped_duplicate ? 'Yes' : 'No'}</TableCell>
                        <TableCell className="text-sm text-red-600 max-w-[220px] truncate" title={d.error || ''}>{d.error || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No reservations were processed.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Debug Cancellation Emails report */}
        {debugResult && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Debug Cancellation Emails</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant={showOnlyMissingFailed ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShowOnlyMissingFailed((v) => !v)}
                  >
                    {showOnlyMissingFailed ? 'Showing missing/failed' : 'Show only missing/failed'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDebugResult(null)}>Dismiss</Button>
                </div>
              </div>
              <CardDescription>
                Inspection of every CANCELLED minimum participant alert. Explains, per reservation, whether it
                should have received a cancellation email and what happened to its email log.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Totals */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Cancelled Alerts</div>
                  <div className="text-2xl font-bold">{debugResult.totals.cancelledAlerts}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Reservations</div>
                  <div className="text-2xl font-bold">{debugResult.totals.reservations}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Should Receive</div>
                  <div className="text-2xl font-bold">{debugResult.totals.shouldReceive}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Sent</div>
                  <div className="text-2xl font-bold text-green-600">{debugResult.totals.sent}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Missing / Failed</div>
                  <div className={`text-2xl font-bold ${debugResult.totals.missingOrFailed > 0 ? 'text-red-600' : ''}`}>
                    {debugResult.totals.missingOrFailed}
                  </div>
                </div>
              </div>

              {debugResult.alerts.length === 0 && (
                <p className="text-sm text-muted-foreground">No CANCELLED minimum participant alerts found.</p>
              )}

              {/* Per-alert sections */}
              {debugResult.alerts.map((alert) => {
                const rows = showOnlyMissingFailed
                  ? alert.reservations.filter((r) => r.needs_action)
                  : alert.reservations
                if (showOnlyMissingFailed && rows.length === 0) return null
                return (
                  <div key={alert.alert_id} className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{alert.tour_name}</span>
                      {alert.tour_date && (
                        <span className="text-sm text-muted-foreground">
                          <FormattedDate dateString={alert.tour_date} />
                        </span>
                      )}
                      <Badge variant="outline" className="text-xs">tour_date_id: {alert.tour_date_id}</Badge>
                      <Badge variant="outline" className="text-xs">{alert.total_reservations} reservations</Badge>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Voucher / Docket</TableHead>
                            <TableHead>Lead Passenger</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Pax</TableHead>
                            <TableHead>Agent Email</TableHead>
                            <TableHead>Should?</TableHead>
                            <TableHead>Log Status</TableHead>
                            <TableHead>Sent At</TableHead>
                            <TableHead>Diagnosis</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((r) => (
                            <TableRow key={r.reservation_id}>
                              <TableCell className="text-sm">
                                <div className="font-medium">{r.voucher_number}</div>
                                <div className="text-xs text-muted-foreground">{r.reservation_number}</div>
                              </TableCell>
                              <TableCell className="text-sm">{r.lead_passenger_name}</TableCell>
                              <TableCell className="text-sm">{r.current_status}</TableCell>
                              <TableCell className="text-sm">{r.participants ?? '-'}</TableCell>
                              <TableCell className="text-sm">{r.agent_email || '-'}</TableCell>
                              <TableCell>
                                {r.should_receive
                                  ? <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">Yes</Badge>
                                  : <Badge variant="outline">No</Badge>}
                              </TableCell>
                              <TableCell>
                                {r.latest_log_status === 'SENT'
                                  ? <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">SENT</Badge>
                                  : r.latest_log_status === 'PENDING'
                                    ? <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">PENDING</Badge>
                                    : r.latest_log_status === 'missing'
                                      ? <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">missing</Badge>
                                      : <Badge variant="destructive">{r.latest_log_status}</Badge>}
                              </TableCell>
                              <TableCell className="text-xs">
                                {r.sent_at ? <FormattedDate dateString={r.sent_at} /> : '-'}
                              </TableCell>
                              <TableCell className="text-xs max-w-[320px]">
                                <span title={r.error_message || ''}>{r.diagnosis}</span>
                              </TableCell>
                              <TableCell>
                                {canAct && r.needs_action ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={sendingReservationId === r.reservation_id}
                                    onClick={() => handleSendMissing(r.reservation_id)}
                                  >
                                    {sendingReservationId === r.reservation_id ? 'Sending...' : 'Send Missing Cancellation Email'}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}

        {/* Check Result Summary */}
        {checkResult && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {checkResult.success ? (
                  <span className="text-green-600">Check Completed</span>
                ) : (
                  <span className="text-red-600">Check Failed</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="bg-slate-50 p-3 rounded">
                  <div className="text-muted-foreground">New Alerts</div>
                  <div className="text-xl font-semibold">{checkResult.alertsCreated}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded">
                  <div className="text-muted-foreground">Existing Alerts</div>
                  <div className="text-xl font-semibold">{checkResult.alertsSkipped}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded">
                  <div className="text-muted-foreground">Email Logs Created</div>
                  <div className="text-xl font-semibold">{checkResult.emailLogsCreated}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded">
                  <div className="text-muted-foreground">Email Logs Skipped</div>
                  <div className="text-xl font-semibold">{checkResult.emailLogsSkipped}</div>
                </div>
              </div>
              
              {checkResult.details.length > 0 && (
                <div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                    className="text-muted-foreground"
                  >
                    {showTechnicalDetails ? 'Hide' : 'Show'} technical details ({checkResult.details.length})
                  </Button>
                  {showTechnicalDetails && (
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs space-y-1 font-mono bg-slate-50 p-3 rounded border">
                      {checkResult.details.map((detail, idx) => (
                        <div key={idx} className={detail.includes('skipped') || detail.includes('Skipped') ? 'text-slate-500' : detail.includes('created') || detail.includes('Created') ? 'text-green-700' : 'text-red-600'}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Repair Result Summary */}
        {repairResult && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {repairResult.success ? (
                  <span className="text-green-600">Repair Completed</span>
                ) : (
                  <span className="text-red-600">Repair Failed</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-slate-50 p-3 rounded">
                  <div className="text-muted-foreground">Email Logs Created</div>
                  <div className="text-xl font-semibold">{repairResult.emailLogsCreated}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded">
                  <div className="text-muted-foreground">Email Logs Skipped</div>
                  <div className="text-xl font-semibold">{repairResult.emailLogsSkipped}</div>
                </div>
              </div>
              
              {repairResult.details.length > 0 && (
                <div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                    className="text-muted-foreground"
                  >
                    {showTechnicalDetails ? 'Hide' : 'Show'} technical details ({repairResult.details.length})
                  </Button>
                  {showTechnicalDetails && (
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs space-y-1 font-mono bg-slate-50 p-3 rounded border">
                      {repairResult.details.map((detail, idx) => (
                        <div key={idx} className={detail.includes('Skipped') ? 'text-slate-500' : detail.includes('Created') ? 'text-green-700' : 'text-red-600'}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Open Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{openAlerts}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Decision Required</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{decisionRequired}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Operational Rows</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{displayAlerts.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label>Alert Stage</Label>
                <Select value={stageFilter} onValueChange={(value) => setStageFilter(value ?? 'all')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stages</SelectItem>
                    <SelectItem value="LOW_PARTICIPANTS_7_DAYS">7 Days Warning</SelectItem>
                    <SelectItem value="LOW_PARTICIPANTS_5_DAYS">5 Days Warning</SelectItem>
                    <SelectItem value="SUPPLIER_DECISION_REQUIRED_3_DAYS">3 Days - Decision Required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Alerts Table */}
        <Card>
          <CardHeader>
            <CardTitle>Alerts ({displayAlerts.length})</CardTitle>
            <CardDescription>
              Upcoming tour dates that may not reach the minimum required participants.
            </CardDescription>
            <p className="text-xs text-muted-foreground mt-1">Minimum required: 4 participants</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading alerts...</div>
            ) : displayAlerts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No alerts found. Click "Run Minimum Participants Check" to scan for low participant tour dates.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tour Date</TableHead>
                    <TableHead>Tour Name</TableHead>
                    <TableHead>Participants</TableHead>
                    <TableHead>Days Left</TableHead>
                    <TableHead>Alert Stage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayAlerts.map(({ alert, isLive, liveDays }) => (
                    <TableRow key={alert.id}>
                      <TableCell>
                        <FormattedDate dateString={(alert.tour_date as any)?.tour_date || ''} />
                      </TableCell>
                      <TableCell className="font-medium">
                        {(alert.tour_date as any)?.tour?.name || 'Unknown Tour'}
                      </TableCell>
                      <TableCell>
                        <span className={alert.active_participants < alert.minimum_required ? 'text-red-600 font-medium' : ''}>
                          {alert.active_participants} / {alert.minimum_required}
                        </span>
                      </TableCell>
                      <TableCell>{liveDays}</TableCell>
                      <TableCell>
                        {isLive ? (
                          getAlertStageBadge(liveDays)
                        ) : alert.status === 'CANCELLED' ? (
                          <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">
                            Cancelled due to minimum participants
                          </Badge>
                        ) : alert.status === 'KEPT' ? (
                          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
                            Tour kept by supplier decision
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(alert.status)}</TableCell>
                      <TableCell>{getDecisionBadge(alert.supplier_decision)}</TableCell>
                      <TableCell className="text-right">
                        {/* Requirement G: show Keep/Cancel ONLY when days_left is 0-3,
                            active participants is 1-3, status is OPEN/NOT CREATED, and
                            no supplier_decision exists. Never for KEPT/CANCELLED/
                            RESOLVED or once a decision is recorded.
                            Stage 5A: hidden entirely for view-only users (canAct = false). */}
                        {canAct &&
                          isLive &&
                          !alert.supplier_decision &&
                          liveDays >= 0 &&
                          liveDays <= 3 &&
                          alert.active_participants >= 1 &&
                          alert.active_participants < 4 && (
                          <div className="flex items-center justify-end gap-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              className="text-green-600 border-green-600 hover:bg-green-50"
                              onClick={() => openDecisionDialog(alert, 'KEEP_TOUR')}
                            >
                              Keep Tour
                            </Button>
                            <Button 
                              size="sm" 
                              variant="destructive"
                              onClick={() => openDecisionDialog(alert, 'CANCEL_TOUR')}
                            >
                              Cancel Tour
                            </Button>
                          </div>
                        )}
                        {/* A KEPT decision may still be changed to Cancel Tour while the
                            tour date is today/future and the date is not cancelled.
                            Stage 5A: hidden for view-only users. */}
                        {canAct &&
                          !isLive &&
                          alert.status === 'KEPT' &&
                          alert.supplier_decision === 'KEEP_TOUR' &&
                          liveDays >= 0 &&
                          (alert.tour_date as any)?.supplier_status !== 'CANCELLED' &&
                          (alert.tour_date as any)?.is_open !== false && (
                          <div className="flex items-center justify-end">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => openDecisionDialog(alert, 'CANCEL_TOUR')}
                            >
                              Cancel Tour
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Past / Resolved Minimum Participant Alerts (collapsed, on-demand) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Past / Resolved Minimum Participant Alerts</CardTitle>
                <CardDescription>
                  Cancelled, kept, and resolved alerts. Loaded only when expanded.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleToggleHistory}>
                {showHistory ? 'Hide History' : 'Show History'}
              </Button>
            </div>
          </CardHeader>
          {showHistory && (
            <CardContent>
              {isLoadingHistory ? (
                <div className="text-center py-8 text-muted-foreground">Loading history...</div>
              ) : historyAlerts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No past or resolved minimum participant alerts.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tour Date</TableHead>
                      <TableHead>Tour</TableHead>
                      <TableHead>Participants</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Decided At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyAlerts.map((alert) => (
                      <TableRow key={alert.id}>
                        <TableCell>
                          <FormattedDate dateString={(alert.tour_date as any)?.tour_date || ''} />
                        </TableCell>
                        <TableCell className="font-medium">
                          {(alert.tour_date as any)?.tour?.name || 'Unknown Tour'}
                        </TableCell>
                        <TableCell>
                          {alert.active_participants} / {alert.minimum_required}
                        </TableCell>
                        <TableCell>{getStatusBadge(alert.status)}</TableCell>
                        <TableCell>{getDecisionBadge(alert.supplier_decision)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {alert.supplier_decision_at
                            ? <FormattedDate dateString={alert.supplier_decision_at} />
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {canAct && alert.status === 'CANCELLED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={repairingAlertId === alert.id}
                              onClick={() => handleRepairAlert(alert.id)}
                            >
                              {repairingAlertId === alert.id ? 'Repairing...' : 'Repair Cancellation Emails'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          )}
        </Card>

        {/* Debug Visible Candidate Dates (collapsed, on-demand) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Debug Visible Candidate Dates</CardTitle>
                <CardDescription>
                  Every tour date in the next 7 days with the exact data used for the
                  inclusion decision (includes excluded 0/4 dates).
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleToggleCandidates}>
                {showCandidates ? 'Hide Debug' : 'Debug Visible Candidate Dates'}
              </Button>
            </div>
          </CardHeader>
          {showCandidates && (
            <CardContent>
              {isLoadingCandidates ? (
                <div className="text-center py-8 text-muted-foreground">Loading candidates...</div>
              ) : candidates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No tour dates in the next 7 days.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tour Date</TableHead>
                      <TableHead>Tour</TableHead>
                      <TableHead>is_open</TableHead>
                      <TableHead>supplier_status</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Included</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>tour_date_id</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((c) => (
                      <TableRow key={c.tour_date_id}>
                        <TableCell>
                          <FormattedDate dateString={c.tour_date} />
                        </TableCell>
                        <TableCell className="font-medium">{c.tour_name}</TableCell>
                        <TableCell>{String(c.is_open)}</TableCell>
                        <TableCell>{c.supplier_status ?? '-'}</TableCell>
                        <TableCell>{c.active_participants}</TableCell>
                        <TableCell>
                          {c.included ? (
                            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">Yes</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted text-muted-foreground">No</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {c.exclusion_reason ?? '-'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.tour_date_id}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          )}
        </Card>
      {/* Decision Dialog */}
      <Dialog open={!!decidingAlert} onOpenChange={(open) => !open && setDecidingAlert(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionType === 'KEEP_TOUR' ? 'Keep Tour' : 'Cancel Tour'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-slate-50 p-4 rounded-lg space-y-2">
              <p><strong>Tour:</strong> {(decidingAlert?.tour_date as any)?.tour?.name}</p>
              <p><strong>Date:</strong> <FormattedDate dateString={(decidingAlert?.tour_date as any)?.tour_date || ''} /></p>
              <p><strong>Current Participants:</strong> {decidingAlert?.active_participants} / {decidingAlert?.minimum_required} required</p>
              <p><strong>Days Until Tour:</strong> {decidingAlert ? computeDaysLeft((decidingAlert.tour_date as any)?.tour_date || '') : ''}</p>
            </div>
            
            {decisionType === 'CANCEL_TOUR' && (
              <div className="bg-red-50 border border-red-200 p-4 rounded-lg text-red-800 text-sm">
                <strong>Warning:</strong> Cancelling this tour will:
                <ul className="list-disc ml-5 mt-2">
                  <li>Set the tour date status to CANCELLED</li>
                  <li>Close the tour date (is_open = false)</li>
                  <li>Cancel all active reservations for this tour date</li>
                  <li>Create email logs for all cancelled reservations</li>
                </ul>
              </div>
            )}
            
            {decisionType === 'KEEP_TOUR' && (
              <div className="bg-green-50 border border-green-200 p-4 rounded-lg text-green-800 text-sm">
                <strong>Note:</strong> Keeping this tour will mark it as confirmed despite low participants. 
                Reservations will not be affected.
              </div>
            )}
            
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea 
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                placeholder="Add any notes about this decision..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecidingAlert(null)}>Cancel</Button>
            <Button 
              variant={decisionType === 'CANCEL_TOUR' ? 'destructive' : 'default'}
              onClick={handleDecision}
              disabled={isPending}
            >
              {isPending ? 'Processing...' : decisionType === 'KEEP_TOUR' ? 'Confirm Keep Tour' : 'Confirm Cancel Tour'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
