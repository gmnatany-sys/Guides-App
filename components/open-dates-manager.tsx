'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchToursAndDates, upsertOpenDate } from '@/app/admin/open-dates/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Tour, TourDate } from '@/lib/types'

function getSupplierStatusVariant(status: string) {
  switch (status) {
    case 'YES':
      return 'default'
    case 'NO':
      return 'secondary'
    case 'CANCELLED':
      return 'destructive'
    default:
      return 'outline'
  }
}

export function OpenDatesManager() {
  const [tours, setTours] = useState<Tour[]>([])
  const [tourDates, setTourDates] = useState<(TourDate & { tours: { name: string } })[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [selectedTourId, setSelectedTourId] = useState<string>('')
  const [tourDate, setTourDate] = useState<string>('')
  const [isOpen, setIsOpen] = useState(true)
  const [supplierStatus, setSupplierStatus] = useState<string>('YES')
  const [notes, setNotes] = useState<string>('')

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await fetchToursAndDates()

      if (result.error) {
        setMessage({ type: 'error', text: result.error })
      } else {
        setTours(result.tours as Tour[])
        setTourDates(result.tourDates as (TourDate & { tours: { name: string } })[])
      }
    } catch (err) {
      console.error('[v0] open-dates-manager fetchData failed:', err)
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
    formData.set('is_open', isOpen ? 'true' : 'false')
    formData.set('supplier_status', supplierStatus)
    formData.set('notes', notes)

    const result = await upsertOpenDate(formData)

    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Failed to save' })
    } else {
      setMessage({ 
        type: 'success', 
        text: result.isUpdate ? 'Tour date updated successfully.' : 'Tour date added successfully.' 
      })
      // Reset form
      setSelectedTourId('')
      setTourDate('')
      setIsOpen(true)
      setSupplierStatus('YES')
      setNotes('')
      // Refresh table
      await fetchData()
    }

    setIsSubmitting(false)
  }

  if (isLoading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Open Dates</h1>
        <p className="text-muted-foreground">
          Manage tour open dates and their statuses.
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Add / Update Open Date</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {message && (
              <div className={`p-3 rounded-md text-sm ${
                message.type === 'success' 
                  ? 'bg-green-500/10 text-green-600' 
                  : 'bg-destructive/10 text-destructive'
              }`}>
                {message.text}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tour_id">Tour</Label>
                <Select value={selectedTourId} onValueChange={setSelectedTourId}>
                  <SelectTrigger>
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
                <Label htmlFor="tour_date">Date</Label>
                <Input 
                  type="date" 
                  id="tour_date" 
                  value={tourDate}
                  onChange={(e) => setTourDate(e.target.value)}
                  required 
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplier_status">Supplier Status</Label>
                <Select value={supplierStatus} onValueChange={setSupplierStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">YES</SelectItem>
                    <SelectItem value="NO">NO</SelectItem>
                    <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="is_open">Is Open</Label>
                <div className="flex items-center gap-2 pt-2">
                  <Switch 
                    id="is_open" 
                    checked={isOpen} 
                    onCheckedChange={setIsOpen} 
                  />
                  <span className="text-sm text-muted-foreground">
                    {isOpen ? 'Open' : 'Closed'}
                  </span>
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes..."
                  rows={2}
                />
              </div>
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Open Dates</CardTitle>
        </CardHeader>
        <CardContent>
          {tourDates.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tour Name</TableHead>
                  <TableHead>Tour Date</TableHead>
                  <TableHead>Is Open</TableHead>
                  <TableHead>Supplier Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Updated At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tourDates.map((td) => (
                  <TableRow key={td.id}>
                    <TableCell className="font-medium">
                      {td.tours?.name || 'Unknown Tour'}
                    </TableCell>
                    <TableCell>
                      {new Date(td.tour_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={td.is_open ? 'default' : 'secondary'}>
                        {td.is_open ? 'Open' : 'Closed'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getSupplierStatusVariant(td.supplier_status)}>
                        {td.supplier_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {td.notes || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(td.updated_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No open dates found. Add one using the form above.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
