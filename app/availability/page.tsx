'use client'

import { useEffect, useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Calendar, Eye } from 'lucide-react'
import { 
  fetchToursForFilter, 
  fetchAvailabilityForCalendar, 
  fetchUpcomingAvailability,
  type TourAvailability 
} from './actions'

interface Tour {
  id: string
  name: string
}

// Status badge colors
function getStatusBadge(status: TourAvailability['availability_status']) {
  switch (status) {
    case 'OPEN':
      return <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">OPEN</Badge>
    case 'ALMOST_FULL':
      return <Badge className="bg-orange-100 text-orange-800 border-orange-300 text-xs">ALMOST FULL</Badge>
    case 'FULL':
      return <Badge className="bg-red-100 text-red-800 border-red-300 text-xs">FULL</Badge>
    case 'CLOSED':
      return <Badge className="bg-gray-100 text-gray-600 border-gray-300 text-xs">CLOSED</Badge>
    case 'CANCELLED':
      return <Badge className="bg-red-100 text-red-700 border-red-400 text-xs">CANCELLED</Badge>
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>
  }
}

export default function AvailabilityPage() {
  const [tours, setTours] = useState<Tour[]>([])
  const [selectedTourId, setSelectedTourId] = useState('all')
  const [calendarData, setCalendarData] = useState<TourAvailability[]>([])
  const [upcomingData, setUpcomingData] = useState<TourAvailability[]>([])
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false)
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(false)
  const [isPending, startTransition] = useTransition()
  
  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })

  // Load tours on mount
  useEffect(() => {
    async function loadTours() {
      try {
        const result = await fetchToursForFilter()
        if (result.tours) {
          setTours(result.tours)
        }
      } catch (err) {
        console.error('[v0] availability loadTours failed:', err)
      }
    }
    loadTours()
  }, [])

  // Load calendar data when month or tour filter changes
  useEffect(() => {
    async function loadCalendarData() {
      setIsLoadingCalendar(true)
      try {
        const result = await fetchAvailabilityForCalendar(
          currentMonth.year, 
          currentMonth.month, 
          selectedTourId === 'all' ? undefined : selectedTourId
        )
        setCalendarData(result.availability || [])
      } catch (err) {
        console.error('[v0] availability loadCalendarData failed:', err)
        setCalendarData([])
      } finally {
        setIsLoadingCalendar(false)
      }
    }
    loadCalendarData()
  }, [currentMonth, selectedTourId])

  // Load upcoming data when tour filter changes
  useEffect(() => {
    async function loadUpcomingData() {
      setIsLoadingUpcoming(true)
      try {
        const result = await fetchUpcomingAvailability(
          selectedTourId === 'all' ? undefined : selectedTourId
        )
        setUpcomingData(result.upcoming || [])
      } catch (err) {
        console.error('[v0] availability loadUpcomingData failed:', err)
        setUpcomingData([])
      } finally {
        setIsLoadingUpcoming(false)
      }
    }
    loadUpcomingData()
  }, [selectedTourId])

  // Calendar navigation
  function goToPreviousMonth() {
    setCurrentMonth(prev => {
      if (prev.month === 1) {
        return { year: prev.year - 1, month: 12 }
      }
      return { year: prev.year, month: prev.month - 1 }
    })
  }

  function goToNextMonth() {
    setCurrentMonth(prev => {
      if (prev.month === 12) {
        return { year: prev.year + 1, month: 1 }
      }
      return { year: prev.year, month: prev.month + 1 }
    })
  }

  // Generate calendar grid
  function generateCalendarDays() {
    const firstDay = new Date(currentMonth.year, currentMonth.month - 1, 1)
    const lastDay = new Date(currentMonth.year, currentMonth.month, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()
    
    const days: (number | null)[] = []
    
    // Add empty cells for days before the first day
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null)
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day)
    }
    
    return days
  }

  // Get availability data for a specific date
  function getAvailabilityForDate(day: number): TourAvailability[] {
    const dateStr = `${currentMonth.year}-${String(currentMonth.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return calendarData.filter(a => a.tour_date === dateStr)
  }

  const monthName = new Date(currentMonth.year, currentMonth.month - 1).toLocaleDateString('en-US', { 
    month: 'long', 
    year: 'numeric' 
  })

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Eye className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Availability Calendar</h1>
                <p className="text-sm text-slate-500">View current tour availability and seats left. This page is read-only.</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Tour Filter */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filter by Tour</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedTourId} onValueChange={setSelectedTourId}>
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue placeholder="Select a tour" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tours</SelectItem>
                {tours.map(tour => (
                  <SelectItem key={tour.id} value={tour.id}>{tour.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Calendar */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Monthly Calendar
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={goToPreviousMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium min-w-[140px] text-center">{monthName}</span>
                <Button variant="outline" size="icon" onClick={goToNextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingCalendar ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-slate-500">Loading calendar...</p>
              </div>
            ) : (
              <>
                {/* Day headers */}
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="text-center text-xs font-medium text-slate-500 py-2">
                      {day}
                    </div>
                  ))}
                </div>
                
                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-1">
                  {generateCalendarDays().map((day, index) => {
                    if (day === null) {
                      return <div key={`empty-${index}`} className="min-h-[80px] sm:min-h-[100px]" />
                    }

                    const dayAvailability = getAvailabilityForDate(day)
                    const hasAvailability = dayAvailability.length > 0

                    return (
                      <div
                        key={day}
                        className={`min-h-[80px] sm:min-h-[100px] border rounded-md p-1 ${
                          hasAvailability ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100'
                        }`}
                      >
                        <div className="text-xs font-medium text-slate-600 mb-1">{day}</div>
                        <div className="space-y-1 overflow-hidden">
                          {dayAvailability.map((avail, idx) => (
                            <div
                              key={idx}
                              className={`text-[10px] sm:text-xs p-1 rounded ${
                                avail.availability_status === 'OPEN' ? 'bg-green-50 border border-green-200' :
                                avail.availability_status === 'ALMOST_FULL' ? 'bg-orange-50 border border-orange-200' :
                                avail.availability_status === 'FULL' ? 'bg-red-50 border border-red-200' :
                                avail.availability_status === 'CANCELLED' ? 'bg-red-50 border border-red-300' :
                                'bg-gray-50 border border-gray-200'
                              }`}
                            >
                              <div className="font-semibold truncate">{avail.tour_short_name}</div>
                              {avail.availability_status === 'FULL' || avail.availability_status === 'CANCELLED' ? (
                                <div className={`text-[9px] sm:text-[10px] ${
                                  avail.availability_status === 'CANCELLED' ? 'text-red-600' : 'text-red-500'
                                }`}>
                                  {avail.availability_status === 'CANCELLED' ? 'CANCELLED' : 'FULL'}
                                </div>
                              ) : avail.availability_status === 'CLOSED' ? (
                                <div className="text-[9px] sm:text-[10px] text-gray-500">CLOSED</div>
                              ) : (
                                <>
                                  <div className="text-[9px] sm:text-[10px] text-slate-600">
                                    {avail.seats_left} seat{avail.seats_left !== 1 ? 's' : ''} left
                                  </div>
                                  <div className={`text-[9px] sm:text-[10px] font-medium ${
                                    avail.availability_status === 'OPEN' ? 'text-green-600' : 'text-orange-600'
                                  }`}>
                                    {avail.availability_status === 'ALMOST_FULL' ? 'ALMOST FULL' : 'OPEN'}
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-green-100 border border-green-300"></div>
                    <span className="text-xs text-slate-600">Open</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-orange-100 border border-orange-300"></div>
                    <span className="text-xs text-slate-600">Almost Full</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-red-100 border border-red-300"></div>
                    <span className="text-xs text-slate-600">Full</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-gray-100 border border-gray-300"></div>
                    <span className="text-xs text-slate-600">Closed</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-red-100 border border-red-400"></div>
                    <span className="text-xs text-slate-600">Cancelled</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Availability List */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Availability</CardTitle>
            <CardDescription>Next 60 days of tour availability</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingUpcoming ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-slate-500">Loading upcoming availability...</p>
              </div>
            ) : upcomingData.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-slate-500">No upcoming availability found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-2 font-medium text-slate-600">Date</th>
                      <th className="text-left py-3 px-2 font-medium text-slate-600">Tour</th>
                      <th className="text-center py-3 px-2 font-medium text-slate-600">Is Open</th>
                      <th className="text-center py-3 px-2 font-medium text-slate-600">Supplier Status</th>
                      <th className="text-center py-3 px-2 font-medium text-slate-600">Active</th>
                      <th className="text-center py-3 px-2 font-medium text-slate-600">Max</th>
                      <th className="text-center py-3 px-2 font-medium text-slate-600">Seats Left</th>
                      <th className="text-center py-3 px-2 font-medium text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingData.map((item, index) => (
                      <tr key={index} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-2 whitespace-nowrap">
                          {new Date(item.tour_date).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </td>
                        <td className="py-3 px-2">{item.tour_name}</td>
                        <td className="py-3 px-2 text-center">
                          {item.is_open ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">Yes</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-300">No</Badge>
                          )}
                        </td>
                        <td className="py-3 px-2 text-center">
                          {item.supplier_status ? (
                            <Badge 
                              variant="outline" 
                              className={
                                item.supplier_status === 'CANCELLED' 
                                  ? 'bg-red-50 text-red-700 border-red-300' 
                                  : 'bg-blue-50 text-blue-700 border-blue-300'
                              }
                            >
                              {item.supplier_status}
                            </Badge>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-center font-medium">{item.active_participants}</td>
                        <td className="py-3 px-2 text-center">{item.max_capacity}</td>
                        <td className="py-3 px-2 text-center font-medium">
                          <span className={
                            item.seats_left <= 0 ? 'text-red-600' :
                            item.seats_left <= 3 ? 'text-orange-600' :
                            'text-green-600'
                          }>
                            {item.seats_left}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center">
                          {getStatusBadge(item.availability_status)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
