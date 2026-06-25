'use client'

import { useState, useEffect, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { 
  fetchReservations, 
  fetchTours, 
  confirmReservation, 
  markNotConfirmed, 
  cancelReservation,
  type ReservationFilters 
} from './actions'
import type { Reservation, Tour } from '@/lib/types'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  })
}

function fmtDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    'WAITING FOR CONFIRMATION': 'bg-yellow-100 text-yellow-800',
    'CONFIRMED': 'bg-green-100 text-green-800',
    'NOT CONFIRMED': 'bg-orange-100 text-orange-800',
    'CANCELLED': 'bg-red-100 text-red-800',
  }
  const label: Record<string, string> = {
    'WAITING FOR CONFIRMATION': 'Waiting',
    'CONFIRMED': 'Confirmed',
    'NOT CONFIRMED': 'Not Conf.',
    'CANCELLED': 'Cancelled',
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${variants[status] || 'bg-gray-100 text-gray-800'}`}>
      {label[status] ?? status}
    </span>
  )
}

// ── detail row helper ─────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 border-b border-border/50 last:border-0">
      <span className="w-36 shrink-0 text-xs text-muted-foreground font-medium">{label}</span>
      <span className="text-sm text-foreground break-words">{value ?? '-'}</span>
    </div>
  )
}

// ── props ─────────────────────────────────────────────────────────────────────

interface Props {
  initialPermissions: string[]
}

// ── main component ────────────────────────────────────────────────────────────

export default function ReservationsClient({ initialPermissions }: Props) {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [tours, setTours] = useState<Tour[]>([])
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const [myPermissions] = useState<string[]>(initialPermissions)
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null)

  const canSearch = myPermissions.includes('reservations_search_access')
  const canAction = myPermissions.includes('reservations_action_access')

  // Filters
  const [statusFilter, setStatusFilter] = useState('all')
  const [tourFilter, setTourFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  const loadData = async (filters: ReservationFilters = {}) => {
    const [reservationsResult, toursResult] = await Promise.all([
      fetchReservations(filters),
      fetchTours()
    ])
    if (reservationsResult.error) {
      setMessage({ type: 'error', text: reservationsResult.error })
    } else {
      setReservations(reservationsResult.reservations)
    }
    if (!toursResult.error) {
      setTours(toursResult.tours)
    }
  }

  // Permissions arrive instantly via initialPermissions — no getMyPermissions useEffect needed.
  // Data still loads on mount via useEffect as before.
  useEffect(() => {
    loadData()
  }, [])

  const currentFilters = (): ReservationFilters => ({
    status: statusFilter,
    tourId: tourFilter,
    dateFrom,
    dateTo,
    search,
  })

  const handleFilter = () => {
    startTransition(async () => {
      setMessage(null)
      await loadData(currentFilters())
    })
  }

  const handleClearFilters = () => {
    setStatusFilter('all')
    setTourFilter('all')
    setDateFrom('')
    setDateTo('')
    setSearch('')
    startTransition(async () => {
      setMessage(null)
      await loadData()
    })
  }

  const handleConfirm = (id: string) => {
    startTransition(async () => {
      setMessage(null)
      const result = await confirmReservation(id)
      if (result.success) {
        setMessage({ type: 'success', text: `Reservation confirmed. Confirmation #: ${result.confirmationNumber}` })
        await loadData(currentFilters())
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to confirm' })
      }
    })
  }

  const handleNotConfirmed = (id: string) => {
    startTransition(async () => {
      setMessage(null)
      const result = await markNotConfirmed(id)
      if (result.success) {
        setMessage({ type: 'success', text: 'Reservation marked as not confirmed.' })
        await loadData(currentFilters())
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update' })
      }
    })
  }

  const handleCancel = (id: string) => {
    startTransition(async () => {
      setMessage(null)
      try {
        const result = await cancelReservation(id)
        if (result.success) {
          if (result.warning) {
            setMessage({ type: 'warning', text: result.warning })
          } else {
            setMessage({ type: 'success', text: 'Reservation cancelled. Cancellation email sent.' })
          }
        } else {
          setMessage({ type: 'error', text: result.error || 'Failed to cancel' })
        }
      } catch (err) {
        console.error('[v0] handleCancel failed:', err)
        setMessage({ type: 'error', text: 'Failed to cancel reservation. Please try again.' })
      } finally {
        await loadData(currentFilters())
      }
    })
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reservations Management</h1>
        <p className="text-muted-foreground">View and manage tour reservations</p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-md ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : message.type === 'warning'
                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="WAITING FOR CONFIRMATION">Waiting for Confirmation</SelectItem>
                  <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                  <SelectItem value="NOT CONFIRMED">Not Confirmed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tour</Label>
              <Select value={tourFilter} onValueChange={setTourFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Tours">
                    {tourFilter === 'all' ? 'All Tours' : tours.find(t => t.id === tourFilter)?.name || 'All Tours'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tours</SelectItem>
                  {tours.map((tour) => (
                    <SelectItem key={tour.id} value={tour.id}>{tour.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Date To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Search</Label>
              <Input
                placeholder={canSearch ? 'Docket, voucher, name, conf#...' : 'Search not permitted'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={!canSearch}
                title={!canSearch ? 'You do not have search access.' : undefined}
              />
            </div>

            <div className="space-y-2 flex items-end gap-2">
              <Button onClick={handleFilter} disabled={isPending}>
                {isPending ? 'Loading...' : 'Apply'}
              </Button>
              <Button variant="outline" onClick={handleClearFilters} disabled={isPending}>
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reservations Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reservations ({reservations.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* No overflow-x-auto — table is designed to fit desktop width */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Created</TableHead>
                <TableHead className="w-20">Tour Date</TableHead>
                <TableHead className="w-24">Docket</TableHead>
                <TableHead className="w-24">Confirm.</TableHead>
                <TableHead className="min-w-[140px]">Customer / Agent</TableHead>
                <TableHead className="min-w-[120px] max-w-[180px]">Tour</TableHead>
                <TableHead className="w-10 text-center">Pax</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No reservations found
                  </TableCell>
                </TableRow>
              ) : (
                reservations.map((res) => (
                  <TableRow
                    key={res.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={(e) => {
                      // Don't open popup when clicking action buttons
                      if ((e.target as HTMLElement).closest('button')) return
                      setSelectedRes(res)
                    }}
                  >
                    {/* Created */}
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(res.created_at)}
                    </TableCell>

                    {/* Tour Date */}
                    <TableCell className="text-xs whitespace-nowrap">
                      {fmtDate(res.tour_dates?.tour_date)}
                    </TableCell>

                    {/* Docket */}
                    <TableCell className="font-mono text-xs">
                      {res.reservation_number}
                    </TableCell>

                    {/* Confirmation # */}
                    <TableCell className="font-mono text-xs max-w-[96px] truncate" title={res.confirmation_number ?? ''}>
                      {res.confirmation_number || '-'}
                    </TableCell>

                    {/* Customer / Agent stacked */}
                    <TableCell className="max-w-[160px]">
                      <div className="text-sm truncate" title={res.lead_passenger_name}>
                        {res.lead_passenger_name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate" title={res.agent_name ?? ''}>
                        {res.agent_name || '-'}
                      </div>
                    </TableCell>

                    {/* Tour — truncated with full name in tooltip */}
                    <TableCell className="max-w-[180px]">
                      <span className="text-sm block truncate" title={res.tours?.name ?? ''}>
                        {res.tours?.name || '-'}
                      </span>
                    </TableCell>

                    {/* Pax */}
                    <TableCell className="text-sm text-center">
                      {res.participants}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <StatusBadge status={res.status} />
                    </TableCell>

                    {/* Actions */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canAction ? (
                        <div className="flex gap-1 flex-wrap">
                          {res.status === 'WAITING FOR CONFIRMATION' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 px-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                                onClick={() => handleConfirm(res.id)}
                                disabled={isPending}
                              >
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                onClick={() => handleNotConfirmed(res.id)}
                                disabled={isPending}
                              >
                                Not Conf
                              </Button>
                            </>
                          )}
                          {res.status !== 'CANCELLED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleCancel(res.id)}
                              disabled={isPending}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Popup */}
      <Dialog open={!!selectedRes} onOpenChange={(open) => { if (!open) setSelectedRes(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Reservation Details
              {selectedRes && <StatusBadge status={selectedRes.status} />}
            </DialogTitle>
          </DialogHeader>
          {selectedRes && (
            <div className="space-y-1 mt-2 max-h-[60vh] overflow-y-auto pr-1">
              <DetailRow label="Docket #" value={<span className="font-mono">{selectedRes.reservation_number}</span>} />
              <DetailRow label="Confirmation #" value={selectedRes.confirmation_number
                ? <span className="font-mono">{selectedRes.confirmation_number}</span>
                : '-'} />
              <DetailRow label="Voucher #" value={selectedRes.voucher_number} />
              <DetailRow label="Created" value={fmtDateLong(selectedRes.created_at)} />
              <DetailRow label="Tour Date" value={fmtDateLong(selectedRes.tour_dates?.tour_date)} />
              <DetailRow label="Tour" value={selectedRes.tours?.name} />
              <DetailRow label="Passengers" value={selectedRes.participants} />
              <DetailRow label="Lead Passenger" value={selectedRes.lead_passenger_name} />
              <DetailRow label="WhatsApp" value={selectedRes.whatsapp_number} />
              <DetailRow label="Agent" value={selectedRes.agent_name} />
              <DetailRow label="Agent Email" value={selectedRes.agent_email} />
              <DetailRow label="Status" value={<StatusBadge status={selectedRes.status} />} />
              {selectedRes.cancelled_at && (
                <DetailRow label="Cancelled At" value={fmtDateLong(selectedRes.cancelled_at)} />
              )}
              {selectedRes.supplier_response_at && (
                <DetailRow label="Supplier Response" value={fmtDateLong(selectedRes.supplier_response_at)} />
              )}
              <DetailRow label="Internal Notes" value={selectedRes.internal_notes || '-'} />
            </div>
          )}
          {/* Actions inside popup */}
          {selectedRes && canAction && (
            <div className="flex gap-2 pt-3 border-t border-border">
              {selectedRes.status === 'WAITING FOR CONFIRMATION' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                    onClick={() => { handleConfirm(selectedRes.id); setSelectedRes(null) }}
                    disabled={isPending}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                    onClick={() => { handleNotConfirmed(selectedRes.id); setSelectedRes(null) }}
                    disabled={isPending}
                  >
                    Not Confirmed
                  </Button>
                </>
              )}
              {selectedRes.status !== 'CANCELLED' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => { handleCancel(selectedRes.id); setSelectedRes(null) }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
