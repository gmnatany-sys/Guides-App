'use client'

import { useState, useEffect, useTransition } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  fetchReservationsByStatus, 
  fetchAllReservationCounts,
  supplierConfirmBooking, 
  supplierMarkNotConfirmed,
  supplierCancelBooking
} from './actions'
import type { Reservation } from '@/lib/types'

type TabStatus = 'WAITING FOR CONFIRMATION' | 'CONFIRMED' | 'NOT CONFIRMED' | 'CANCELLED'

export default function SupplierConfirmPage() {
  const [activeTab, setActiveTab] = useState<TabStatus>('WAITING FOR CONFIRMATION')
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [counts, setCounts] = useState({ waiting: 0, confirmed: 0, notConfirmed: 0, cancelled: 0 })
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null)
  const loadData = async () => {
    setIsLoading(true)
    try {
      const [reservationsResult, countsResult] = await Promise.all([
        fetchReservationsByStatus(activeTab, search),
        fetchAllReservationCounts()
      ])
      setReservations(reservationsResult.reservations)
      setCounts(countsResult)
    } catch (err) {
      console.error('[v0] supplier/confirm loadData failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load reservations.' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [activeTab])

  const handleSearch = () => {
    startTransition(() => {
      loadData()
    })
  }

  const handleRefresh = () => {
    setMessage(null)
    startTransition(() => {
      loadData()
    })
  }

  const handleConfirm = async (id: string) => {
    setProcessingId(id)
    setMessage(null)
    try {
      const result = await supplierConfirmBooking(id)
      if (result.success) {
        if (result.warning) {
          setMessage({ type: 'error', text: result.warning })
        } else {
          setMessage({ type: 'success', text: `Booking confirmed! Confirmation #: ${result.confirmationNumber}` })
        }
        await loadData()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to confirm booking.' })
      }
    } catch (err) {
      console.error('[v0] handleConfirm failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to confirm booking.' })
    } finally {
      setProcessingId(null)
    }
  }

  const handleNotConfirmed = async (id: string) => {
    setProcessingId(id)
    setMessage(null)
    try {
      const result = await supplierMarkNotConfirmed(id)
      if (result.success) {
        if (result.warning) {
          setMessage({ type: 'error', text: result.warning })
        } else {
          setMessage({ type: 'success', text: 'Booking marked as not confirmed.' })
        }
        await loadData()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update booking.' })
      }
    } catch (err) {
      console.error('[v0] handleNotConfirmed failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update booking.' })
    } finally {
      setProcessingId(null)
    }
  }

  const handleCancelBooking = async (id: string) => {
    setProcessingId(id)
    setCancelConfirmId(null)
    setMessage(null)
    try {
      const result = await supplierCancelBooking(id)
      if (result.success) {
        if (result.warning) {
          setMessage({ type: 'error', text: result.warning })
        } else {
          setMessage({ type: 'success', text: 'Booking cancelled successfully.' })
        }
        await loadData()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to cancel booking.' })
      }
    } catch (err) {
      console.error('[v0] handleCancelBooking failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to cancel booking.' })
    } finally {
      setProcessingId(null)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const ReservationCard = ({ reservation, showActions, showCancelButton }: { reservation: Reservation, showActions: boolean, showCancelButton: boolean }) => (
    <Card className="border-slate-200">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header Row */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{reservation.reservation_number}</span>
                {reservation.voucher_number && (
                  <Badge variant="outline" className="text-xs">{reservation.voucher_number}</Badge>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Created: {formatDateTime(reservation.created_at)}</p>
            </div>
            {reservation.status === 'CONFIRMED' && reservation.confirmation_number && (
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                {reservation.confirmation_number}
              </Badge>
            )}
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-slate-500">Lead Passenger:</span>
              <span className="ml-1 text-slate-900 font-medium">{reservation.lead_passenger_name}</span>
            </div>
            {reservation.whatsapp_number && (
              <div>
                <span className="text-slate-500">WhatsApp:</span>
                <span className="ml-1 text-slate-900">{reservation.whatsapp_number}</span>
              </div>
            )}
            <div>
              <span className="text-slate-500">Tour:</span>
              <span className="ml-1 text-slate-900">{reservation.tours?.name || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-500">Date:</span>
              <span className="ml-1 text-slate-900">{reservation.tour_dates?.tour_date ? formatDate(reservation.tour_dates.tour_date) : 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-500">Participants:</span>
              <span className="ml-1 text-slate-900 font-medium">{reservation.participants}</span>
            </div>
            {reservation.status === 'CANCELLED' && reservation.cancelled_at && (
              <div>
                <span className="text-slate-500">Cancelled:</span>
                <span className="ml-1 text-red-600">{formatDateTime(reservation.cancelled_at)}</span>
              </div>
            )}
          </div>

          {/* Internal Notes */}
          {reservation.internal_notes && (
            <div className="bg-slate-50 p-2 rounded text-sm">
              <span className="text-slate-500">Notes:</span>
              <span className="ml-1 text-slate-700">{reservation.internal_notes}</span>
            </div>
          )}

          {/* Actions for Waiting tab */}
          {showActions && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              <Button
                size="sm"
                onClick={() => handleConfirm(reservation.id)}
                disabled={processingId === reservation.id}
                className="bg-green-600 hover:bg-green-700"
              >
                {processingId === reservation.id ? 'Processing...' : 'Confirm Booking'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleNotConfirmed(reservation.id)}
                disabled={processingId === reservation.id}
                className="border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                {processingId === reservation.id ? 'Processing...' : 'Mark Not Confirmed'}
              </Button>
            </div>
          )}

          {/* Cancel Button for Confirmed tab */}
          {showCancelButton && (
            <div className="pt-2 border-t border-slate-100">
              {cancelConfirmId === reservation.id ? (
                <div className="bg-red-50 p-3 rounded-md space-y-2">
                  <p className="text-sm text-red-800 font-medium">Are you sure you want to cancel this booking?</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleCancelBooking(reservation.id)}
                      disabled={processingId === reservation.id}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      {processingId === reservation.id ? 'Cancelling...' : 'Yes, Cancel Booking'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCancelConfirmId(null)}
                      disabled={processingId === reservation.id}
                    >
                      No, Keep It
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelConfirmId(reservation.id)}
                  disabled={processingId === reservation.id}
                  className="border-red-300 text-red-700 hover:bg-red-50"
                >
                  Cancel Booking
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Supplier Confirmation Queue</h1>
          <p className="text-sm text-slate-600 mt-1">
            Review and confirm or reject booking requests.
          </p>
        </div>

        {/* Search and Refresh */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Search by voucher, reservation #, or passenger name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Button onClick={handleSearch} disabled={isPending}>
              Search
            </Button>
            <Button variant="outline" onClick={handleRefresh} disabled={isPending}>
              Refresh
            </Button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`p-3 rounded-md text-sm ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-800 border border-green-200' 
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabStatus)}>
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto">
            <TabsTrigger value="WAITING FOR CONFIRMATION" className="text-xs sm:text-sm py-2">
              Waiting
              <Badge variant="secondary" className="ml-1.5 bg-yellow-100 text-yellow-800 text-xs">
                {counts.waiting}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="CONFIRMED" className="text-xs sm:text-sm py-2">
              Confirmed
              <Badge variant="secondary" className="ml-1.5 bg-green-100 text-green-800 text-xs">
                {counts.confirmed}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="NOT CONFIRMED" className="text-xs sm:text-sm py-2">
              Not Conf
              <Badge variant="secondary" className="ml-1.5 bg-orange-100 text-orange-800 text-xs">
                {counts.notConfirmed}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="CANCELLED" className="text-xs sm:text-sm py-2">
              Cancelled
              <Badge variant="secondary" className="ml-1.5 bg-red-100 text-red-800 text-xs">
                {counts.cancelled}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* Tab Content */}
          {(['WAITING FOR CONFIRMATION', 'CONFIRMED', 'NOT CONFIRMED', 'CANCELLED'] as const).map((status) => (
            <TabsContent key={status} value={status} className="mt-4">
              {isLoading ? (
                <div className="text-center py-8 text-slate-500">Loading...</div>
              ) : reservations.length === 0 ? (
                <Card className="border-slate-200">
                  <CardContent className="p-6 text-center text-slate-500">
                    No {status.toLowerCase()} bookings found.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {reservations.map((reservation) => (
                    <ReservationCard 
                      key={reservation.id} 
                      reservation={reservation} 
                      showActions={status === 'WAITING FOR CONFIRMATION'}
                      showCancelButton={status === 'CONFIRMED'}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  )
}
