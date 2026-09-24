'use server'

import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { setDates } from '@/lib/booking-workflows'
import { revalidatePath } from 'next/cache'

export async function fetchTours() {
  await requirePermission("supplier_confirmation_view")

  const supabase = await createClient()
  const { data, error } = await supabase.from('tours').select('*').order('name')
  return { tours: data || [], error: error?.message || null }
}

export async function fetchOpenTourDatesForMonth(tourId: string, year: number, month: number) {
  await requirePermission("supplier_confirmation_view")

  const supabase = await createClient()
  
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  
  const { data, error } = await supabase
    .from('tour_dates')
    .select('*')
    .eq('tour_id', tourId)
    .gte('tour_date', startDate)
    .lte('tour_date', endDate)
  
  if (error) {
    return { tourDates: [], error: error.message }
  }
  
  return { tourDates: data || [], error: null }
}

export async function fetchRecentlyCancelledDates(limit: number = 10) {
  await requirePermission("supplier_confirmation_view")

  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('tour_dates')
    .select('*, tours(name)')
    .eq('supplier_status', 'CANCELLED')
    .order('updated_at', { ascending: false })
    .limit(limit)
  
  if (error) {
    return { cancelledDates: [], error: error.message }
  }

  // For each cancelled date, count how many reservations were cancelled
  const cancelledDatesWithCounts = await Promise.all(
    (data || []).map(async (tourDate) => {
      const { count } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('tour_date_id', tourDate.id)
        .eq('status', 'CANCELLED')
      
      return {
        ...tourDate,
        cancelled_reservations_count: count || 0
      }
    })
  )
  
  return { cancelledDates: cancelledDatesWithCounts, error: null }
}

export async function cancelSelectedDates(tourId: string, dates: string[], cancellationNotes: string) {
  return setDates(tourId, dates, false, 'CANCELLED', 'supplier_confirmation_action', cancellationNotes || 'Cancelled by supplier.')
}
