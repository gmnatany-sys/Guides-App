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
  resolveAlert,
  checkAndCreateAlerts,
  type MinimumParticipantAlert 
} from './actions'

// Client-side date formatter
function FormattedDate({ dateString }: { dateString: string }) {
  const [formatted, setFormatted] = useState<string>('')
  
  useEffect(() => {
    const date = new Date(dateString)
    setFormatted(date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    }))
  }, [dateString])
  
  if (!formatted) return null
  return <>{formatted}</>
}

function getAlertStageBadge(stage: string) {
  switch (stage) {
    case 'LOW_PARTICIPANTS_7_DAYS':
      return <Badge className="bg-yellow-100 text-yellow-800">7 Days Warning</Badge>
    case 'LOW_PARTICIPANTS_5_DAYS':
      return <Badge className="bg-orange-100 text-orange-800">5 Days Warning</Badge>
    case 'SUPPLIER_DECISION_REQUIRED_3_DAYS':
      return <Badge className="bg-red-100 text-red-800">3 Days - Decision Required</Badge>
    default:
      return <Badge variant="outline">{stage}</Badge>
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'OPEN':
      return <Badge className="bg-blue-100 text-blue-800">Open</Badge>
    case 'RESOLVED':
      return <Badge className="bg-gray-100 text-gray-800">Resolved</Badge>
    case 'CANCELLED':
      return <Badge className="bg-red-100 text-red-800">Cancelled</Badge>
    case 'KEPT':
      return <Badge className="bg-green-100 text-green-800">Kept</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<MinimumParticipantAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  
  // Decision dialog
  const [decidingAlert, setDecidingAlert] = useState<MinimumParticipantAlert | null>(null)
  const [decision, setDecision] = useState<'KEEP_TOUR' | 'CANCEL_TOUR' | ''>('')
  const [notes, setNotes] = useState('')

  async function loadAlerts() {
    setLoading(true)
    try {
      const { alerts: data } = await fetchMinimumParticipantAlerts({
        status: statusFilter,
        alert_stage: stageFilter
      })
      setAlerts(data)
    } catch (err) {
      console.error('[v0] alerts loadAlerts failed:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [])

  function handleApplyFilters() {
    loadAlerts()
  }

  function handleClearFilters() {
    setStatusFilter('all')
    setStageFilter('all')
    startTransition(async () => {
      const { alerts: data } = await fetchMinimumParticipantAlerts()
      setAlerts(data)
    })
  }

  async function handleRunCheck() {
    setMessage(null)
    startTransition(async () => {
      const result = await checkAndCreateAlerts()
      if (result.success) {
        setMessage({ 
          type: 'success', 
          text: `Check completed. ${result.alertsCreated} new alerts created.` 
        })
        loadAlerts()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to run check' })
      }
    })
  }

  async function handleResolveAlert() {
    if (!decidingAlert || !decision) return
    
    startTransition(async () => {
      const result = await resolveAlert(decidingAlert.id, decision, notes)
      if (result.success) {
        setMessage({ 
          type: 'success', 
          text: `Alert resolved. Tour ${decision === 'KEEP_TOUR' ? 'will proceed' : 'has been cancelled'}.` 
        })
        setDecidingAlert(null)
        setDecision('')
        setNotes('')
        loadAlerts()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to resolve alert' })
      }
    })
  }

  const openAlerts = alerts.filter(a => a.status === 'OPEN').length
  const decisionRequiredAlerts = alerts.filter(
    a => a.status === 'OPEN' && a.alert_stage === 'SUPPLIER_DECISION_REQUIRED_3_DAYS'
  ).length

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Minimum Participant Alerts</h1>
          <p className="text-muted-foreground">
            Monitor tours with fewer than 4 participants approaching their date.
          </p>
        </div>
        <Button onClick={handleRunCheck} disabled={isPending}>
          {isPending ? 'Checking...' : 'Run Check Now'}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{openAlerts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Decision Required</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{decisionRequiredAlerts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{alerts.length}</div>
          </CardContent>
        </Card>
      </div>

      {message && (
        <div className={`p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="KEPT">Kept</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Alert Stage</Label>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  <SelectItem value="LOW_PARTICIPANTS_7_DAYS">7 Days Warning</SelectItem>
                  <SelectItem value="LOW_PARTICIPANTS_5_DAYS">5 Days Warning</SelectItem>
                  <SelectItem value="SUPPLIER_DECISION_REQUIRED_3_DAYS">3 Days Decision</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleApplyFilters}>Apply</Button>
            <Button variant="outline" onClick={handleClearFilters}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      {/* Alerts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Alerts ({alerts.length})</CardTitle>
          <CardDescription>
            Tours with fewer than minimum required participants
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading alerts...</div>
          ) : alerts.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No alerts found. All tours have sufficient participants.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tour</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Participants</TableHead>
                  <TableHead>Days Left</TableHead>
                  <TableHead>Alert Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell className="font-medium">
                      {(alert.tour_date as any)?.tour?.name || 'Unknown Tour'}
                    </TableCell>
                    <TableCell>
                      <FormattedDate dateString={(alert.tour_date as any)?.tour_date || alert.created_at} />
                    </TableCell>
                    <TableCell>
                      <span className="text-red-600 font-medium">{alert.active_participants}</span>
                      <span className="text-muted-foreground"> / {alert.minimum_required}</span>
                    </TableCell>
                    <TableCell>{alert.days_before_tour} days</TableCell>
                    <TableCell>{getAlertStageBadge(alert.alert_stage)}</TableCell>
                    <TableCell>{getStatusBadge(alert.status)}</TableCell>
                    <TableCell>
                      {alert.supplier_decision ? (
                        <Badge variant={alert.supplier_decision === 'KEEP_TOUR' ? 'default' : 'destructive'}>
                          {alert.supplier_decision === 'KEEP_TOUR' ? 'Keep' : 'Cancel'}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {alert.status === 'OPEN' && (
                        <Button 
                          size="sm" 
                          onClick={() => setDecidingAlert(alert)}
                        >
                          Make Decision
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Decision Dialog */}
      <Dialog open={!!decidingAlert} onOpenChange={(open) => !open && setDecidingAlert(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make Decision for Tour</DialogTitle>
          </DialogHeader>
          {decidingAlert && (
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                <p><strong>Tour:</strong> {(decidingAlert.tour_date as any)?.tour?.name}</p>
                <p><strong>Date:</strong> <FormattedDate dateString={(decidingAlert.tour_date as any)?.tour_date || ''} /></p>
                <p><strong>Current Participants:</strong> {decidingAlert.active_participants} / {decidingAlert.minimum_required} required</p>
                <p><strong>Days Until Tour:</strong> {decidingAlert.days_before_tour}</p>
              </div>
              
              <div className="space-y-2">
                <Label>Decision</Label>
                <Select value={decision} onValueChange={(v) => setDecision(v as any)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a decision" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KEEP_TOUR">Keep Tour - Proceed despite low participants</SelectItem>
                    <SelectItem value="CANCEL_TOUR">Cancel Tour - Not enough participants</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Notes (Optional)</Label>
                <Textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this decision..."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecidingAlert(null)}>Cancel</Button>
            <Button 
              onClick={handleResolveAlert} 
              disabled={isPending || !decision}
              variant={decision === 'CANCEL_TOUR' ? 'destructive' : 'default'}
            >
              {isPending ? 'Saving...' : 'Confirm Decision'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
