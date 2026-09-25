'use server'

import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { setDates } from '@/lib/booking-workflows'
import { revalidatePath } from 'next/cache'

export async function fetchToursAndDates() {
  await requirePermission("open_dates_view_access", "availability_calendar_manage_access")

  const supabase = await createClient()
  
  const [toursResult, tourDatesResult] = await Promise.all([
    supabase.from('tours').select('*').order('name'),
    supabase.from('tour_dates').select('*, tours(name), guide:app_users!tour_dates_guide_user_id_fkey(full_name)').order('tour_date', { ascending: true })
  ])

  return {
    tours: toursResult.data || [],
    tourDates: tourDatesResult.data || [],
    error: toursResult.error?.message || tourDatesResult.error?.message || null
  }
}

export async function addOpenDate(formData: FormData) {
  return upsertOpenDate(formData)
}

export async function upsertOpenDate(formData: FormData) {
  return setDates(String(formData.get('tour_id') ?? ''), [String(formData.get('tour_date') ?? '')], formData.get('is_open') === 'true', String(formData.get('supplier_status') ?? 'NO'), 'availability_calendar_manage_access', String(formData.get('notes') ?? ''), String(formData.get('guide_user_id') ?? '') || undefined)
}

// Fetch tour dates for a specific tour and month
export async function fetchTourDatesForMonth(tourId: string, year: number, month: number, guideId?: string) {
  await requirePermission("availability_calendar_manage_access")

  const supabase = await createClient()
  
  // First day of month
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  // Last day of month
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  
  const { data, error } = await supabase
    .from('tour_dates')
    .select('*')
    .eq('tour_id', tourId)
    .match(guideId ? {guide_user_id:guideId} : {})
    .gte('tour_date', startDate)
    .lte('tour_date', endDate)
  
  if (error) {
    return { tourDates: [], error: error.message }
  }
  
  return { tourDates: data || [], error: null }
}

// Bulk upsert dates - open selected dates
export async function bulkOpenDates(tourId: string, dates: string[], guideId?: string) {
  return setDates(tourId, dates, true, 'YES', 'availability_calendar_manage_access', undefined, guideId)
}

// Bulk upsert dates - close selected dates
export async function bulkCloseDates(tourId: string, dates: string[], guideId?: string) {
  return setDates(tourId, dates, false, 'NO', 'availability_calendar_manage_access', undefined, guideId)
}

// Cancel selected dates - sets is_open=false, supplier_status=CANCELLED, cancels reservations, sends emails immediately
export async function cancelSelectedDates(tourId: string, dates: string[], guideId?: string) {
  return setDates(tourId, dates, false, 'CANCELLED', 'availability_calendar_manage_access', 'Tour date cancelled from Availability Calendar.', guideId)
}
