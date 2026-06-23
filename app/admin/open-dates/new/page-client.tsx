'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchToursAndDates, fetchTourDatesForMonth, bulkOpenDates, cancelSelectedDates } from '../actions'
import type { Tour, TourDate } from '@/lib/types'

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function AvailabilityCalendarPage() {
  const [tours, setTours] = useState<Tour[]>([])
  const [selectedTourId, setSelectedTourId] = useState<string>('')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [tourDates, setTourDates] = useState<TourDate[]>([])
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // Load tours on mount
  useEffect(() => {
    async function loadTours() {
      setLoading(true)
      try {
        const result = await fetchToursAndDates()
        setTours(result.tours as Tour[])
        if (result.tours && result.tours.length > 0) {
          setSelectedTourId(result.tours[0].id)
        }
      } catch (err) {
        console.error('[v0] open-dates/new loadTours failed:', err)
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
      const result = await fetchTourDatesForMonth(selectedTourId, year, month)
      setTourDates(result.tourDates as TourDate[])
    } catch (err) {
      console.error('[v0] open-dates/new loadTourDates failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load tour dates.' })
    }
  }, [selectedTourId, currentDate])

  useEffect(() => {
    loadTourDates()
  }, [loadTourDates])

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

  // Format date as YYYY-MM-DD
  const formatDateString = (day: number) => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // Check if a date is open
  const isDateOpen = (day: number) => {
    const dateStr = formatDateString(day)
    return tourDates.some(td => td.tour_date === dateStr && td.is_open)
  }

  // Check if a date is selected
  const isDateSelected = (day: number) => {
    const dateStr = formatDateString(day)
    return selectedDates.has(dateStr)
  }

  // Toggle date selection
  const toggleDate = (day: number) => {
    const dateStr = formatDateString(day)
    const newSelected = new Set(selectedDates)
    if (newSelected.has(dateStr)) {
      newSelected.delete(dateStr)
    } else {
      newSelected.add(dateStr)
    }
    setSelectedDates(newSelected)
    setMessage(null)
  }

  // Navigate months
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
    setSelectedDates(new Set())
    setMessage(null)
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
    setSelectedDates(new Set())
    setMessage(null)
  }

  // Analyze selected dates
  const getSelectedDateAnalysis = () => {
    let openCount = 0
    let closedCount = 0
    
    selectedDates.forEach(dateStr => {
      const isOpen = tourDates.some(td => td.tour_date === dateStr && td.is_open)
      if (isOpen) {
        openCount++
      } else {
        closedCount++
      }
    })
    
    return { openCount, closedCount, hasMixed: openCount > 0 && closedCount > 0 }
  }

  const { openCount, closedCount, hasMixed } = getSelectedDateAnalysis()

  // Bulk actions
  const handleOpenSelected = async () => {
    if (selectedDates.size === 0 || !selectedTourId) return
    setProcessing(true)
    setMessage(null)
    
    // Only open dates that are currently closed
    const closedDatesToOpen = Array.from(selectedDates).filter(dateStr => {
      return !tourDates.some(td => td.tour_date === dateStr && td.is_open)
    })
    
    if (closedDatesToOpen.length === 0) {
      setMessage({ type: 'error', text: 'All selected dates are already open.' })
      setProcessing(false)
      return
    }
    
    try {
      const result = await bulkOpenDates(selectedTourId, closedDatesToOpen)

      if (result.success) {
        setMessage({ type: 'success', text: result.message })
        setSelectedDates(new Set())
        await loadTourDates()
      } else {
        setMessage({ type: 'error', text: result.message })
      }
    } catch (err) {
      console.error('[v0] handleOpenSelected failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to open dates.' })
    } finally {
      setProcessing(false)
    }
  }

  const handleCancelSelected = async () => {
    if (selectedDates.size === 0 || !selectedTourId) return
    setProcessing(true)
    setMessage(null)
    setShowCancelConfirm(false)
    
    // Only cancel dates that are currently open
    const openDatesToCancel = Array.from(selectedDates).filter(dateStr => {
      return tourDates.some(td => td.tour_date === dateStr && td.is_open)
    })
    
    if (openDatesToCancel.length === 0) {
      setMessage({ type: 'error', text: 'No open dates selected to cancel.' })
      setProcessing(false)
      return
    }
    
    try {
      const result = await cancelSelectedDates(selectedTourId, openDatesToCancel)

      if (result.success) {
        setMessage({ type: 'success', text: result.message })
        setSelectedDates(new Set())
        await loadTourDates()
      } else {
        setMessage({ type: 'error', text: result.message + (result.errors.length > 0 ? ' ' + result.errors.join(', ') : '') })
      }
    } catch (err) {
      console.error('[v0] handleCancelSelected failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to cancel dates.' })
    } finally {
      setProcessing(false)
    }
  }

  const monthYear = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  if (loading) {
    return <div className="p-6">Loading...</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Availability Calendar</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Use this calendar to open or cancel availability for the selected tour. Cancelling an open date will also cancel active bookings and create cancellation email logs.
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
            setMessage(null)
          }}>
            <SelectTrigger className="w-full max-w-md">
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
        </CardContent>
      </Card>

      {/* Calendar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Calendar</CardTitle>
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
                  className={`
                    aspect-square flex items-center justify-center rounded-md text-sm font-medium
                    transition-colors border-2
                    ${isSelected 
                      ? 'bg-blue-600 text-white border-blue-600' 
                      : isOpen 
                        ? 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200' 
                        : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
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
              <span>Open</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-slate-100 border-2 border-slate-200" />
              <span>Closed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-blue-600 border-2 border-blue-600" />
              <span>Selected</span>
            </div>
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

          {/* Mixed selection warning */}
          {hasMixed && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-md text-sm">
              Your selection includes both open and closed dates. Open action will open closed dates. Cancel action will cancel open dates only.
            </div>
          )}

          {/* Cancellation confirmation dialog */}
          {showCancelConfirm && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-md space-y-3">
              <p className="text-sm text-red-800 font-medium">
                Are you sure you want to cancel the selected open dates? This will cancel all active bookings on those dates and create cancellation email logs.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleCancelSelected}
                  disabled={processing}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {processing ? 'Cancelling...' : 'Yes, Cancel Dates'}
                </Button>
                <Button
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={processing}
                  variant="outline"
                >
                  No, Keep Dates
                </Button>
              </div>
            </div>
          )}

          {!showCancelConfirm && (
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleOpenSelected}
                disabled={selectedDates.size === 0 || closedCount === 0 || processing}
                className="bg-green-600 hover:bg-green-700"
              >
                {processing ? 'Processing...' : `Open Selected Dates (${closedCount})`}
              </Button>
              <Button
                onClick={() => setShowCancelConfirm(true)}
                disabled={selectedDates.size === 0 || openCount === 0 || processing}
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                {processing ? 'Processing...' : `Cancel Selected Dates (${openCount})`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
