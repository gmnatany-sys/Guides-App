'use client'

import { useState, useEffect, useTransition } from 'react'
import { Card, CardContent } from '@/components/ui/card'
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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchBookingInitialData, fetchTourDatesForCalendar, submitBooking } from './actions'
import type { Tour } from '@/lib/types'

interface CalendarDate {
  id: string
  tour_id: string
  tour_date: string
  is_open: boolean
  supplier_status?: string | null
  seats_left: number
  is_full: boolean
}

interface Agent {
  id: string
  full_name: string
  email: string
}

export default function BookingPage() {
  const [tours, setTours] = useState<Tour[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [selectedTourId, setSelectedTourId] = useState('')
  // Single source of truth for the chosen availability. We never store the
  // tour_date_id separately from the rest of the date info, so they cannot diverge.
  const [selectedDateInfo, setSelectedDateInfo] = useState<CalendarDate | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  
  // Form field state for validation
  const [participants, setParticipants] = useState('')
  const [docketNumber, setDocketNumber] = useState('')
  const [voucherNumber, setVoucherNumber] = useState('')
  const [leadPassengerName, setLeadPassengerName] = useState('')
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [participantsError, setParticipantsError] = useState<string | null>(null)
  const [formSubmitAttempted, setFormSubmitAttempted] = useState(false)
  
  // Calendar state
  const [calendarDates, setCalendarDates] = useState<CalendarDate[]>([])
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })

  // Load active tours and agents in a single server action on mount.
  // One Supabase client, two parallel queries, one network round trip.
  useEffect(() => {
    async function loadInitialData() {
      try {
        const { tours: toursData, agents: agentsData } = await fetchBookingInitialData()
        setTours(toursData)
        setAgents(agentsData)
      } catch (err) {
        console.error('[v0] booking loadInitialData failed:', err)
      }
    }
    loadInitialData()
  }, [])

  // Load calendar dates when tour or month changes
  useEffect(() => {
    if (!selectedTourId) {
      setCalendarDates([])
      setSelectedDateInfo(null)
      return
    }

    async function loadCalendarDates() {
      setIsLoadingCalendar(true)
      try {
        const { calendarDates: dates } = await fetchTourDatesForCalendar(
          selectedTourId, 
          currentMonth.year, 
          currentMonth.month
        )
        setCalendarDates(dates)
        // If the currently-selected date is not present in the newly loaded month,
        // clear it so a stale tour_date_id can never linger in the hidden input.
        setSelectedDateInfo((prev) => {
          if (prev && !dates.some((d) => d.id === prev.id)) {
            setParticipants('')
            setParticipantsError(null)
            return null
          }
          return prev
        })
      } catch (err) {
        console.error('[v0] booking loadCalendarDates failed:', err)
        setCalendarDates([])
      } finally {
        setIsLoadingCalendar(false)
      }
    }
    loadCalendarDates()
  }, [selectedTourId, currentMonth])

  // Reset selection when tour changes
  useEffect(() => {
    setSelectedDateInfo(null)
    setParticipants('')
    setParticipantsError(null)
  }, [selectedTourId])

  // Validate participants when changed
  useEffect(() => {
    if (!participants || !selectedDateInfo) {
      setParticipantsError(null)
      return
    }
    const numParticipants = parseInt(participants, 10)
    if (numParticipants > selectedDateInfo.seats_left) {
      setParticipantsError(`Only ${selectedDateInfo.seats_left} seat${selectedDateInfo.seats_left !== 1 ? 's' : ''} are available for this date.`)
    } else if (numParticipants < 1) {
      setParticipantsError('Number of participants must be at least 1.')
    } else {
      setParticipantsError(null)
    }
  }, [participants, selectedDateInfo])

  function handlePrevMonth() {
    setCurrentMonth(prev => {
      if (prev.month === 1) {
        return { year: prev.year - 1, month: 12 }
      }
      return { year: prev.year, month: prev.month - 1 }
    })
  }

  function handleNextMonth() {
    setCurrentMonth(prev => {
      if (prev.month === 12) {
        return { year: prev.year + 1, month: 1 }
      }
      return { year: prev.year, month: prev.month + 1 }
    })
  }

  function handleDateSelect(date: CalendarDate) {
    if (!date.is_open || date.is_full) return
    // Store the whole availability object as one unit (id, tour_id, tour_date, seats).
    setSelectedDateInfo(date)
  }

  async function handleSubmit(formData: FormData) {
    setMessage(null)
    setFormSubmitAttempted(true)
    
    // Client-side validation before submit
    const missingFields: string[] = []
    if (!selectedAgentId) missingFields.push('Agent')
    if (!selectedTourId) missingFields.push('Tour')
    if (!selectedDateInfo) missingFields.push('Available Date')
    if (!docketNumber.trim()) missingFields.push('Docket Number')
    if (!voucherNumber.trim()) missingFields.push('Voucher Number')
    if (!leadPassengerName.trim()) missingFields.push('Lead Passenger Name')
    if (!whatsappNumber.trim()) missingFields.push('WhatsApp Number')
    if (!participants) missingFields.push('Number of Participants')
    
    if (missingFields.length > 0) {
      setMessage({ type: 'error', text: `Please fill in all required fields: ${missingFields.join(', ')}` })
      return
    }

    // Guard: the selected availability must belong to the currently selected tour.
    if (selectedDateInfo && selectedDateInfo.tour_id !== selectedTourId) {
      setMessage({ type: 'error', text: 'The selected date does not match the selected tour. Please re-select the date.' })
      setSelectedDateInfo(null)
      return
    }
    
    if (participantsError) {
      setMessage({ type: 'error', text: participantsError })
      return
    }
    
    startTransition(async () => {
      try {
        const result = await submitBooking(formData)

        if (result.success) {
          setMessage({ type: 'success', text: 'Booking submitted successfully.' })
          // Reset form state
          setSelectedAgentId('')
          setSelectedTourId('')
          setSelectedDateInfo(null)
          setCalendarDates([])
          setParticipants('')
          setDocketNumber('')
          setVoucherNumber('')
          setLeadPassengerName('')
          setWhatsappNumber('')
          setParticipantsError(null)
          setFormSubmitAttempted(false)
          // Reset form fields
          const form = document.getElementById('booking-form') as HTMLFormElement
          form?.reset()
        } else {
          setMessage({ type: 'error', text: result.error || 'Failed to submit booking.' })
        }
      } catch (err) {
        console.error('[v0] booking handleSubmit failed:', err)
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to submit booking.' })
      }
    })
  }

  // Generate calendar grid
  function renderCalendar() {
    const year = currentMonth.year
    const month = currentMonth.month
    const firstDay = new Date(year, month - 1, 1).getDay() // 0 = Sunday
    const daysInMonth = new Date(year, month, 0).getDate()
    
    // Create a map of tour_date string to CalendarDate for quick lookup
    const dateMap = new Map<string, CalendarDate>()
    calendarDates.forEach(cd => {
      dateMap.set(cd.tour_date, cd)
    })
    
    const weeks: (number | null)[][] = []
    let currentWeek: (number | null)[] = []
    
    // Fill in empty cells for days before the first of the month
    for (let i = 0; i < firstDay; i++) {
      currentWeek.push(null)
    }
    
    // Fill in the days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      currentWeek.push(day)
      if (currentWeek.length === 7) {
        weeks.push(currentWeek)
        currentWeek = []
      }
    }
    
    // Fill in remaining empty cells
    while (currentWeek.length > 0 && currentWeek.length < 7) {
      currentWeek.push(null)
    }
    if (currentWeek.length > 0) {
      weeks.push(currentWeek)
    }

    const monthName = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

    return (
      <div className="space-y-3">
        {/* Month Navigation */}
        <div className="flex items-center justify-between">
          <Button 
            type="button" 
            variant="outline" 
            size="sm" 
            onClick={handlePrevMonth}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-slate-800">{monthName}</span>
          <Button 
            type="button" 
            variant="outline" 
            size="sm" 
            onClick={handleNextMonth}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Calendar Grid */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          {/* Day Headers */}
          <div className="grid grid-cols-7 bg-slate-100 text-center text-xs font-medium text-slate-600">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="py-2 border-b border-slate-200">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar Weeks */}
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className="grid grid-cols-7">
              {week.map((day, dayIdx) => {
                if (day === null) {
                  return (
                    <div key={dayIdx} className="h-16 md:h-20 bg-slate-50 border-b border-r border-slate-200 last:border-r-0" />
                  )
                }

                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const calendarDate = dateMap.get(dateStr)
                const isSelected = !!calendarDate && calendarDate.id === selectedDateInfo?.id
                const isAvailable = calendarDate?.is_open && !calendarDate?.is_full
                const isClosed = !calendarDate || !calendarDate.is_open
                const isFull = calendarDate?.is_open && calendarDate?.is_full

                let cellClass = 'h-16 md:h-20 p-1 border-b border-r border-slate-200 last:border-r-0 flex flex-col items-center justify-center text-center transition-colors '
                
                if (isSelected) {
                  cellClass += 'bg-blue-600 text-white cursor-pointer'
                } else if (isAvailable) {
                  cellClass += 'bg-green-50 hover:bg-green-100 cursor-pointer'
                } else if (isFull) {
                  cellClass += 'bg-orange-50 text-orange-600 cursor-not-allowed'
                } else if (isClosed) {
                  cellClass += 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }

                return (
                  <div
                    key={dayIdx}
                    className={cellClass}
                    onClick={() => calendarDate && isAvailable && handleDateSelect(calendarDate)}
                  >
                    <span className={`text-sm font-medium ${isSelected ? 'text-white' : ''}`}>
                      {day}
                    </span>
                    {isFull && (
                      <span className="text-[10px] md:text-xs font-semibold mt-0.5">
                        FULL
                      </span>
                    )}
                    {isAvailable && !isSelected && calendarDate && (
                      <span className="text-[10px] md:text-xs text-green-700 mt-0.5">
                        {calendarDate.seats_left} seat{calendarDate.seats_left !== 1 ? 's' : ''}
                      </span>
                    )}
                    {isSelected && calendarDate && (
                      <span className="text-[10px] md:text-xs text-blue-100 mt-0.5">
                        {calendarDate.seats_left} seat{calendarDate.seats_left !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-green-50 border border-green-200 rounded" />
            <span>Available</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-orange-50 border border-orange-200 rounded" />
            <span>Full</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-slate-100 border border-slate-200 rounded" />
            <span>Closed</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-blue-600 border border-blue-600 rounded" />
            <span>Selected</span>
          </div>
        </div>

        {/* No dates message */}
        {calendarDates.length === 0 && !isLoadingCalendar && (
          <div className="p-3 text-sm text-orange-700 bg-orange-50 rounded-md border border-orange-200 text-center">
            No available dates for this month.
          </div>
        )}

        {/* Selected Date Display */}
        {selectedDateInfo && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-800">
              Selected date:{' '}
              {new Date(selectedDateInfo.tour_date).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}{' '}
              — {selectedDateInfo.seats_left} seat{selectedDateInfo.seats_left !== 1 ? 's' : ''} left
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">Japan Tours Booking</h1>
          <p className="text-sm text-slate-600">
            Book your tour by filling out the form below.
          </p>
        </div>

        {message && (
          <div
            className={`p-4 rounded-lg text-sm font-medium ${
              message.type === 'success'
                ? 'bg-green-100 text-green-800 border border-green-200'
                : 'bg-red-100 text-red-800 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6">
            <form id="booking-form" action={handleSubmit} className="space-y-5">
              {/* Hidden fields derived from the single selectedDateInfo source of truth */}
              <input type="hidden" name="tour_date_id" value={selectedDateInfo?.id || ''} />
              <input type="hidden" name="selected_tour_date" value={selectedDateInfo?.tour_date || ''} />
              {/* Hidden field for agent_user_id */}
              <input type="hidden" name="agent_user_id" value={selectedAgentId} />

              {/* Agent Selection */}
              <div className="space-y-2">
                <Label htmlFor="agent_user_id" className="text-slate-700">
                  Agent <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={selectedAgentId}
                  onValueChange={(value) => setSelectedAgentId(value ?? '')}
                  required
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select an agent">
                      {agents.find(a => a.id === selectedAgentId)?.full_name || 'Select an agent'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {agents.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-slate-500">No active agents available.</div>
                    ) : (
                      agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.full_name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {formSubmitAttempted && !selectedAgentId && (
                  <p className="text-sm text-red-600">Agent is required.</p>
                )}
              </div>

              {/* Tour Selection */}
              <div className="space-y-2">
                <Label htmlFor="tour_id" className="text-slate-700">
                  Tour <span className="text-red-500">*</span>
                </Label>
                <Select 
                  name="tour_id" 
                  value={selectedTourId} 
                  onValueChange={(value) => setSelectedTourId(value ?? '')}
                  required
                >
                  <SelectTrigger className="bg-white">
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

              {/* Available Date - Calendar */}
              <div className="space-y-2">
                <Label className="text-slate-700">
                  Available Date <span className="text-red-500">*</span>
                </Label>
                {isLoadingCalendar ? (
                  <div className="p-3 text-sm text-slate-500 bg-slate-100 rounded-md text-center">
                    Loading calendar...
                  </div>
                ) : !selectedTourId ? (
                  <div className="p-3 text-sm text-slate-500 bg-slate-100 rounded-md text-center">
                    Please select a tour first.
                  </div>
                ) : (
                  renderCalendar()
                )}
              </div>

              {/* Docket Number (stored as reservation_number in DB) */}
              <div className="space-y-2">
                <Label htmlFor="reservation_number" className="text-slate-700">
                  Docket Number <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="reservation_number"
                  name="reservation_number"
                  type="text"
                  placeholder="e.g., Docket 123456"
                  className={`bg-white ${formSubmitAttempted && !docketNumber.trim() ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                  value={docketNumber}
                  onChange={(e) => setDocketNumber(e.target.value)}
                  required
                />
                {formSubmitAttempted && !docketNumber.trim() && (
                  <p className="text-sm text-red-600">Docket Number is required.</p>
                )}
              </div>

              {/* Voucher Number */}
              <div className="space-y-2">
                <Label htmlFor="voucher_number" className="text-slate-700">
                  Voucher Number <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="voucher_number"
                  name="voucher_number"
                  type="text"
                  placeholder="e.g., VCH-001"
                  className={`bg-white ${formSubmitAttempted && !voucherNumber.trim() ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                  value={voucherNumber}
                  onChange={(e) => setVoucherNumber(e.target.value)}
                  required
                />
                {formSubmitAttempted && !voucherNumber.trim() && (
                  <p className="text-sm text-red-600">Voucher Number is required.</p>
                )}
              </div>

              {/* Lead Passenger Name */}
              <div className="space-y-2">
                <Label htmlFor="lead_passenger_name" className="text-slate-700">
                  Lead Passenger Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="lead_passenger_name"
                  name="lead_passenger_name"
                  type="text"
                  placeholder="e.g., John Smith"
                  className={`bg-white ${formSubmitAttempted && !leadPassengerName.trim() ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                  value={leadPassengerName}
                  onChange={(e) => setLeadPassengerName(e.target.value)}
                  required
                />
                {formSubmitAttempted && !leadPassengerName.trim() && (
                  <p className="text-sm text-red-600">Lead Passenger Name is required.</p>
                )}
              </div>

              {/* WhatsApp Number */}
              <div className="space-y-2">
                <Label htmlFor="whatsapp_number" className="text-slate-700">
                  WhatsApp Number <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="whatsapp_number"
                  name="whatsapp_number"
                  type="tel"
                  placeholder="e.g., +81 90 1234 5678"
                  className={`bg-white ${formSubmitAttempted && !whatsappNumber.trim() ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  required
                />
                {formSubmitAttempted && !whatsappNumber.trim() && (
                  <p className="text-sm text-red-600">WhatsApp Number is required.</p>
                )}
              </div>

              {/* Number of Participants */}
              <div className="space-y-2">
                <Label htmlFor="participants" className="text-slate-700">
                  Number of Participants <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="participants"
                  name="participants"
                  type="number"
                  min="1"
                  max={selectedDateInfo?.seats_left || undefined}
                  placeholder={selectedDateInfo ? `Max ${selectedDateInfo.seats_left} participant${selectedDateInfo.seats_left !== 1 ? 's' : ''}` : 'Select a date first'}
                  className={`bg-white ${participantsError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                  value={participants}
                  onChange={(e) => setParticipants(e.target.value)}
                  disabled={!selectedDateInfo}
                  required
                />
                {participantsError && (
                  <p className="text-sm text-red-600">{participantsError}</p>
                )}
                {!selectedDateInfo && (
                  <p className="text-sm text-slate-500">Please select a date first.</p>
                )}
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  isPending || 
                  !selectedAgentId ||
                  !selectedTourId || 
                  !selectedDateInfo || 
                  !docketNumber.trim() || 
                  !voucherNumber.trim() ||
                  !leadPassengerName.trim() || 
                  !whatsappNumber.trim() ||
                  !participants || 
                  !!participantsError ||
                  parseInt(participants, 10) < 1 ||
                  !!(selectedDateInfo && parseInt(participants, 10) > selectedDateInfo.seats_left)
                }
              >
                {isPending ? 'Submitting...' : 'Submit Booking'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
