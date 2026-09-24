'use server'

import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { setDates } from '@/lib/booking-workflows'
import { revalidatePath } from 'next/cache'

export async function fetchToursAndRecentDates() {
  await requirePermission("supplier_confirmation_view")

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
  const status = String(formData.get('status') ?? '')
  const result = await setDates(String(formData.get('tour_id') ?? ''), [String(formData.get('tour_date') ?? '')], status === 'YES', status, 'supplier_confirmation_action', String(formData.get('notes') ?? ''))
  return { ...result, isUpdate: true }
}
