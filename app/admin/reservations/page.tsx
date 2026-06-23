'use client'

import { useEffect, useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  fetchReservations, 
  fetchTours, 
  confirmReservation, 
  markNotConfirmed, 
  cancelReservation,
  type ReservationFilters 
} from './actions'
import { getMyPermissions } from '@/app/actions/permissions'
import type { Reservation, Tour } from '@/lib/types'

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    'WAITING FOR CONFIRMATION': 'bg-yellow-100 text-yellow-800',
    'CONFIRMED': 'bg-green-100 text-green-800',
    'NOT CONFIRMED': 'bg-orange-100 text-orange-800',
    'CANCELLED': 'bg-red-100 text-red-800',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variants[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  )
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [tours, setTours] = useState<Tour[]>([])
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const [myPermissions, setMyPermissions] = useState<string[]>([])

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

  useEffect(() => {
    getMyPermissions().then(setMyPermissions)
    loadData()
  }, [])

  const handleFilter = () => {
    startTransition(async () => {
      setMessage(null)
      await loadData({
        status: statusFilter,
        tourId: tourFilter,
        dateFrom,
        dateTo,
        search
      })
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
    if (!canAction) {
      setMessage({ type: 'error', text: 'You do not have permission to perform this action.' })
      return
    }
    startTransition(async () => {
      setMessage(null)
      const result = await confirmReservation(id)
      if (result.success) {
        setMessage({ type: 'success', text: `Reservation confirmed. Confirmation #: ${result.confirmationNumber}` })
        await loadData({
          status: statusFilter,
          tourId: tourFilter,
          dateFrom,
          dateTo,
          search
        })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to confirm' })
      }
    })
  }

  const handleNotConfirmed = (id: string) => {
    if (!canAction) {
      setMessage({ type: 'error', text: 'You do not have permission to perform this action.' })
      return
    }
    startTransition(async () => {
      setMessage(null)
      const result = await markNotConfirmed(id)
      if (result.success) {
        setMessage({ type: 'success', text: 'Reservation marked as not confirmed.' })
        await loadData({
          status: statusFilter,
          tourId: tourFilter,
          dateFrom,
          dateTo,
          search
        })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update' })
      }
    })
  }

  const handleCancel = (id: string) => {
    if (!canAction) {
      setMessage({ type: 'error', text: 'You do not have permission to perform this action.' })
      return
    }
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
        // Always refresh the table so the row reflects the latest status and
        // the Cancel action never stays stuck on "Processing".
        await loadData({
          status: statusFilter,
          tourId: tourFilter,
          dateFrom,
          dateTo,
          search
        })
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
              <Label>Search by docket, voucher, client name, or confirmation number</Label>
              <Input 
                placeholder={canSearch ? 'Enter search term...' : 'Search not permitted'}
                value={search} 
                onChange={(e) => setSearch(e.target.value)}
                disabled={!canSearch}
                title={!canSearch ? 'You do not have search access.' : undefined}
              />
              {!canSearch && (
                <p className="text-xs text-muted-foreground">Search is not available for your user.</p>
              )}
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
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Res #</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Lead Passenger</TableHead>
                  <TableHead>Agent Name</TableHead>
                  <TableHead>Agent Email</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Tour</TableHead>
                  <TableHead>Tour Date</TableHead>
                  <TableHead>Pax</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Conf #</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                      No reservations found
                    </TableCell>
                  </TableRow>
                ) : (
                  reservations.map((res) => (
                    <TableRow key={res.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(res.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{res.reservation_number}</TableCell>
                      <TableCell className="text-sm">{res.voucher_number || '-'}</TableCell>
                      <TableCell className="text-sm">{res.lead_passenger_name}</TableCell>
                      <TableCell className="text-sm">{res.agent_name || '-'}</TableCell>
                      <TableCell className="text-sm">{res.agent_email || '-'}</TableCell>
                      <TableCell className="text-sm">{res.whatsapp_number || '-'}</TableCell>
                      <TableCell className="text-sm">{res.tours?.name || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {res.tour_dates?.tour_date 
                          ? new Date(res.tour_dates.tour_date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          : '-'}
                      </TableCell>
                      <TableCell className="text-sm">{res.participants}</TableCell>
                      <TableCell>
                        <StatusBadge status={res.status} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{res.confirmation_number || '-'}</TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate">
                        {res.internal_notes || '-'}
                      </TableCell>
                      <TableCell>
                        {canAction ? (
                          <div className="flex gap-1">
                            {res.status === 'WAITING FOR CONFIRMATION' && (
                              <>
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => handleConfirm(res.id)}
                                  disabled={isPending}
                                >
                                  Confirm
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
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
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
