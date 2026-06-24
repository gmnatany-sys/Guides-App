'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { syncMinimumParticipantsForTourDate } from '@/app/admin/alerts/actions'

export async function fetchToursAndRecentDates() {
  const supabase = await createClient()
  
  const [toursResult, tourDatesResult] = await Promise.all([
    supabase.from('tours').select('*').order('name'),
    supabase
      .from('tour_dates')
      .select('*, tours(name)')
      .order('updated_at', { ascending: false })
      .limit(30)
  ])

  return {
    tours: toursResult.data || [],
    tourDates: tourDatesResult.data || [],
    error: toursResult.error?.message || tourDatesResult.error?.message || null
  }
}

export async function submitSupplierAvailability(formData: FormData) {
  // This page has been deprecated. All availability management is now handled
  // through the Availability Calendar (/admin/open-dates).
  return { success: false, error: 'This page has been replaced by the Availability Calendar.' }

  // The code below is intentionally unreachable.
  const tourId = formData.get('tour_id') as string
  const tourDate = formData.get('tour_date') as string
  const status = formData.get('status') as string
  const notes = formData.get('notes') as string

  // Determine is_open and supplier_status based on status
  let isOpen: boolean
  let supplierStatus: string

  switch (status) {
    case 'YES':
      supplierStatus = 'YES'
      isOpen = true
      break
    case 'NO':
      supplierStatus = 'NO'
      isOpen = false
      break
    case 'CANCELLED':
      supplierStatus = 'CANCELLED'
      isOpen = false
      break
    default:
      return { success: false, error: 'Invalid status' }
  }

  const supabase = await createClient()
  
  // Check if record exists
  const { data: existing } = await supabase
    .from('tour_dates')
    .select('id')
    .eq('tour_id', tourId)
    .eq('tour_date', tourDate)
    .single()

  let error
  let affectedId: string | null = existing?.id ?? null
  if (existing) {
    // Update existing record
    const { error: updateError } = await supabase
      .from('tour_dates')
      .update({
        is_open: isOpen,
        supplier_status: supplierStatus,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    error = updateError
  } else {
    // Insert new record
    const { data: inserted, error: insertError } = await supabase
      .from('tour_dates')
      .insert({
        tour_id: tourId,
        tour_date: tourDate,
        is_open: isOpen,
        supplier_status: supplierStatus,
        notes: notes || null,
      })
      .select('id')
      .single()
    error = insertError
    affectedId = inserted?.id ?? null
  }

  if (error) {
    return { success: false, error: error.message }
  }

  // Live minimum-participants sync for only this date (open/close/cancel).
  if (affectedId) {
    try {
      await syncMinimumParticipantsForTourDate(affectedId)
    } catch (err) {
      console.error('[v0] minimum-participants sync failed after supplier availability:', err)
    }
  }

  revalidatePath('/supplier/availability')
  return { success: true, isUpdate: !!existing }
}
