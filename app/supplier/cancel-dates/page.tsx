'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { 
  fetchTours, 
  fetchOpenTourDatesForMonth, 
  fetchRecentlyCancelledDates,
  cancelSelectedDates 
} from './actions'
import type { Tour, TourDate } from '@/lib/types'

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface CancelledDateWithCount extends TourDate {
  cancelled_reservations_count: number
  tours?: { name: string }
}

export default function SupplierCancelDatesPage() {
  const [tours, setTours] = useState<Tour[]>([])
  const [selectedTourId, setSelectedTourId] = useState<string>('')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [tourDates, setTourDates] = useState<TourDate[]>([])
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [cancellationNotes, setCancellationNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [cancelledDates, setCancelledDates] = useState<CancelledDateWithCount[]>([])

  // Load tours on mount
  useEffect(() => {
    async function loadTours() {
      setLoading(true)
      try {
        const result = await fetchTours()
        setTours(result.tours as Tour[])
        if (result.tours && result.tours.length > 0) {
          setSelectedTourId(result.tours[0].id)
        }
      } catch (err) {
        console.error('[v0] cancel-dates loadTours failed:', err)
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load tours.' })
      } finally {
        setLoading(false)
      }
    }
    loadTours()
  }, [])

  // Load tour dates when tour or month changes
  const loadTourDates = useCallback(async () => {
    if (!selectedTourId) return
    
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1
    try {
      const result = await fetchOpenTourDatesForMonth(selectedTourId, year, month)
      setTourDates(result.tourDates as TourDate[])
    } catch (err) {
      console.error('[v0] cancel-dates loadTourDates failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load tour dates.' })
    }
  }, [selectedTourId, currentDate])

  // Load recently cancelled dates
  const loadCancelledDates = useCallback(async () => {
    try {
      const result = await fetchRecentlyCancelledDates(10)
      setCancelledDates(result.cancelledDates as CancelledDateWithCount[])
    } catch (err) {
      console.error('[v0] cancel-dates loadCancelledDates failed:', err)
    }
  }, [])

  useEffect(() => {
    loadTourDates()
  }, [loadTourDates])

  useEffect(() => {
    loadCancelledDates()
  }, [loadCancelledDates])

  // Get calendar data for current month
  const getCalendarDays = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startPadding = firstDay.getDay()
    const daysInMonth = lastDay.getDate()
    
    const days: (number | null)[] = []
    
    for (let i = 0; i < startPadding; i++) {
      days.push(null)
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i)
    }
    
    return days
  }

  const formatDateString = (day: number) => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const getTourDateRecord = (day: number) => {
    const dateStr = formatDateString(day)
    return tourDates.find(td => td.tour_date === dateStr)
  }

  const isDateOpen = (day: number) => {
    const record = getTourDateRecord(day)
    return record?.is_open === true
  }

  const isDateSelected = (day: number) => {
    const dateStr = formatDateString(day)
    return selectedDates.has(dateStr)
  }

  const toggleDate = (day: number) => {
    if (!isDateOpen(day)) return // Only allow selecting open dates
    
    const dateStr = formatDateString(day)
    const newSelected = new Set(selectedDates)
    if (newSelected.has(dateStr)) {
      newSelected.delete(dateStr)
    } else {
      newSelected.add(dateStr)
    }
    setSelectedDates(newSelected)
  }

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
    setSelectedDates(new Set())
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
    setSelectedDates(new Set())
  }

  const handleCancelClick = () => {
    if (selectedDates.size === 0) return
    setShowConfirmation(true)
  }

  const handleConfirmCancel = async () => {
    if (selectedDates.size === 0 || !selectedTourId) return
    
    setProcessing(true)
    setShowConfirmation(false)
    setMessage(null)
    
    const result = await cancelSelectedDates(
      selectedTourId, 
      Array.from(selectedDates), 
      cancellationNotes
    )
    
    if (result.success) {
      setMessage({ type: 'success', text: result.message })
      setSelectedDates(new Set())
      setCancellationNotes('')
      await loadTourDates()
      await loadCancelledDates()
    } else {
      setMessage({ type: 'error', text: result.message + (result.errors.length > 0 ? ' ' + result.errors.join('; ') : '') })
    }
    
    setProcessing(false)
  }

  const clearSelection = () => {
    setSelectedDates(new Set())
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
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

  const monthYear = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  if (loading) {
    return <div className="p-6">Loading...</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cancel Open Tour Dates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cancel open dates and automatically cancel all active bookings.
        </p>
      </div>

      {/* Tour Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Select Tour</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedTourId} onValueChange={(value) => {
            setSelectedTourId(value)
            setSelectedDates(new Set())
          }}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select a tour" />
            </SelectTrigger>
            <SelectContent>
              {tours.map((tour) => (
                <SelectItem key={tour.id} value={tour.id}>
                  {tour.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Calendar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Month Calendar</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-medium min-w-[160px] text-center">{monthYear}</span>
              <Button variant="outline" size="icon" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Days of week header */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DAYS_OF_WEEK.map((day) => (
              <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {getCalendarDays().map((day, index) => {
              if (day === null) {
                return <div key={`empty-${index}`} className="aspect-square" />
              }

              const isOpen = isDateOpen(day)
              const isSelected = isDateSelected(day)

              return (
                <button
                  key={day}
                  onClick={() => toggleDate(day)}
                  disabled={!isOpen}
                  className={`
                    aspect-square flex items-center justify-center rounded-md text-sm font-medium
                    transition-colors border-2
                    ${isSelected 
                      ? 'bg-red-600 text-white border-red-600' 
                      : isOpen 
                        ? 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200 cursor-pointer' 
                        : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                    }
                  `}
                >
                  {day}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-green-100 border-2 border-green-300" />
              <span>Open (selectable)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-slate-100 border-2 border-slate-200" />
              <span>Closed (disabled)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-red-600 border-2 border-red-600" />
              <span>Selected for cancellation</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cancellation Notes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cancellation Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Enter reason for cancellation..."
              value={cancellationNotes}
              onChange={(e) => setCancellationNotes(e.target.value)}
              className="max-w-xl"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div className={`p-3 rounded-md text-sm ${
              message.type === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          {/* Confirmation Dialog */}
          {showConfirmation && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-md space-y-3">
              <p className="text-sm text-red-800 font-medium">
                Are you sure you want to cancel the selected dates? This will cancel all active bookings for these dates and create cancellation email logs.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleConfirmCancel}
                  disabled={processing}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {processing ? 'Processing...' : 'Yes, Cancel Dates'}
                </Button>
                <Button
                  onClick={() => setShowConfirmation(false)}
                  disabled={processing}
                  variant="outline"
                >
                  No, Go Back
                </Button>
              </div>
            </div>
          )}

          {!showConfirmation && (
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleCancelClick}
                disabled={selectedDates.size === 0 || processing}
                className="bg-red-600 hover:bg-red-700"
              >
                {processing ? 'Processing...' : `Cancel Selected Dates (${selectedDates.size})`}
              </Button>
              <Button
                onClick={clearSelection}
                disabled={selectedDates.size === 0 || processing}
                variant="outline"
              >
                Clear Selection
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recently Cancelled Dates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently Cancelled Dates</CardTitle>
        </CardHeader>
        <CardContent>
          {cancelledDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recently cancelled dates.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tour Date</TableHead>
                    <TableHead>Tour Name</TableHead>
                    <TableHead>Bookings Cancelled</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Updated At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cancelledDates.map((date) => (
                    <TableRow key={date.id}>
                      <TableCell className="font-medium">{formatDate(date.tour_date)}</TableCell>
                      <TableCell>{date.tours?.name || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                          {date.cancelled_reservations_count}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{date.notes || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {date.updated_at ? formatDateTime(date.updated_at) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
