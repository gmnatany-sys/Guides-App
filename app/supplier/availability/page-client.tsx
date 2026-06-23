'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchToursAndRecentDates, submitSupplierAvailability } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import type { Tour, TourDate } from '@/lib/types'

function StatusBadge({ status }: { status: string }) {
  const baseClasses = "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
  
  switch (status) {
    case 'YES':
      return <span className={`${baseClasses} bg-green-100 text-green-800`}>YES</span>
    case 'NO':
      return <span className={`${baseClasses} bg-gray-100 text-gray-800`}>NO</span>
    case 'CANCELLED':
      return <span className={`${baseClasses} bg-red-100 text-red-800`}>CANCELLED</span>
    default:
      return <span className={`${baseClasses} bg-gray-100 text-gray-600`}>{status}</span>
  }
}

export default function SupplierAvailabilityPage() {
  const [tours, setTours] = useState<Tour[]>([])
  const [tourDates, setTourDates] = useState<(TourDate & { tours: { name: string } })[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [selectedTourId, setSelectedTourId] = useState<string>('')
  const [tourDate, setTourDate] = useState<string>('')
  const [status, setStatus] = useState<string>('YES')
  const [notes, setNotes] = useState<string>('')

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await fetchToursAndRecentDates()

      if (result.error) {
        setMessage({ type: 'error', text: result.error })
      } else {
        setTours(result.tours as Tour[])
        setTourDates(result.tourDates as (TourDate & { tours: { name: string } })[])
      }
    } catch (err) {
      console.error('[v0] supplier/availability fetchData failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load data.' })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage(null)

    if (!selectedTourId || !tourDate) {
      setMessage({ type: 'error', text: 'Please select a tour and date.' })
      setIsSubmitting(false)
      return
    }

    const formData = new FormData()
    formData.set('tour_id', selectedTourId)
    formData.set('tour_date', tourDate)
    formData.set('status', status)
    formData.set('notes', notes)

    try {
      const result = await submitSupplierAvailability(formData)

      if (!result.success) {
        setMessage({ type: 'error', text: 'Could not update availability. Please contact Japan Tours.' })
      } else {
        setMessage({ type: 'success', text: 'Availability updated successfully.' })
        // Reset form
        setSelectedTourId('')
        setTourDate('')
        setStatus('YES')
        setNotes('')
        // Refresh table
        await fetchData()
      }
    } catch (err) {
      console.error('[v0] supplier availability handleSubmit failed:', err)
      setMessage({ type: 'error', text: 'Could not update availability. Please contact Japan Tours.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-lg mx-auto text-slate-500 text-center py-12">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-slate-900">Japan Tours Supplier Availability</h1>
          <p className="text-sm text-slate-600">
            Please update availability for each tour date. Changes are saved automatically to Japan Tours operations system.
          </p>
        </div>

        {/* Form */}
        <Card className="border-slate-200">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {message && (
                <div className={`p-3 rounded-lg text-sm font-medium ${
                  message.type === 'success' 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {message.text}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="tour_id" className="text-slate-700">Tour</Label>
                <Select value={selectedTourId} onValueChange={setSelectedTourId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a tour">
                      {tours.find(t => t.id === selectedTourId)?.name || 'Select a tour'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {tours.map((tour) => (
                      <SelectItem key={tour.id} value={tour.id}>
                        {tour.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tour_date" className="text-slate-700">Tour Date</Label>
                <Input 
                  type="date" 
                  id="tour_date" 
                  value={tourDate}
                  onChange={(e) => setTourDate(e.target.value)}
                  className="w-full"
                  required 
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status" className="text-slate-700">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        YES - Available
                      </span>
                    </SelectItem>
                    <SelectItem value="NO">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                        NO - Not Available
                      </span>
                    </SelectItem>
                    <SelectItem value="CANCELLED">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        CANCELLED
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes" className="text-slate-700">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes..."
                  rows={2}
                  className="w-full resize-none"
                />
              </div>

              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-slate-900 hover:bg-slate-800"
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Recent Updates */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Recent Updates</h2>
          <p className="text-sm text-slate-600">Latest 30 tour date updates, ordered by most recent.</p>
          
          {tourDates.length > 0 ? (
            <div className="space-y-2">
              {tourDates.map((td) => (
                <Card key={td.id} className="border-slate-200">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-slate-900">
                              {new Date(td.tour_date).toLocaleDateString('en-US', { 
                                weekday: 'short',
                                month: 'short', 
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 mt-0.5">
                            {td.tours?.name || 'Unknown Tour'}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={td.supplier_status} />
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          td.is_open 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-orange-100 text-orange-800'
                        }`}>
                          {td.is_open ? 'Open' : 'Closed'}
                        </span>
                      </div>

                      {td.notes && (
                        <p className="text-sm text-slate-500 bg-slate-50 p-2 rounded">
                          {td.notes}
                        </p>
                      )}
                      
                      <div className="text-xs text-slate-400 pt-1 border-t border-slate-100">
                        Updated: {new Date(td.updated_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-slate-200">
              <CardContent className="p-6">
                <p className="text-slate-500 text-center text-sm">
                  No updates yet.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
