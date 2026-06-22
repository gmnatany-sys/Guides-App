'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addOpenDate } from '@/app/admin/open-dates/actions'
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
import type { Tour } from '@/lib/types'

interface AddOpenDateFormProps {
  tours: Tour[]
}

export function AddOpenDateForm({ tours }: AddOpenDateFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)

    const formData = new FormData(event.currentTarget)
    const result = await addOpenDate(formData)

    if (!result.success) {
      setError(result.error || 'Failed to add open date')
      setIsSubmitting(false)
      return
    }

    router.push('/admin/open-dates')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="tour_id">Tour</Label>
        <Select name="tour_id" required>
          <SelectTrigger>
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
      </div>

      <div className="space-y-2">
        <Label htmlFor="tour_date">Date</Label>
        <Input type="date" name="tour_date" id="tour_date" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="is_open">Status</Label>
        <Select name="is_open" defaultValue="true">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Open</SelectItem>
            <SelectItem value="false">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="supplier_status">Supplier Status</Label>
        <Select name="supplier_status" defaultValue="YES">
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
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          name="notes"
          id="notes"
          placeholder="Optional notes about this date..."
          rows={3}
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Adding...' : 'Add Open Date'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/admin/open-dates')}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
