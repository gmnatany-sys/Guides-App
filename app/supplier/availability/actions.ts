'use server'

import { getServiceRoleClient as createClient } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { setDates } from '@/lib/booking-workflows'
import { revalidatePath } from 'next/cache'
import { toursForActor } from '@/lib/guide-access'

export async function fetchToursAndRecentDates() {
  const actor = await requirePermission("supplier_confirmation_view")

  const supabase = await createClient()
  
  const [toursResult, tourDatesResult] = await Promise.all([
    toursForActor(actor),
    supabase
      .from('tour_dates')
      .select('*, tours(name), guide:app_users!tour_dates_guide_user_id_fkey(full_name)')
      .match(actor.role === 'supplier' ? {guide_user_id:actor.id} : {})
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
  const result = await setDates(String(formData.get('tour_id') ?? ''), [String(formData.get('tour_date') ?? '')], status === 'YES', status, 'supplier_confirmation_action', String(formData.get('notes') ?? ''),String(formData.get('guide_user_id') ?? '') || undefined)
  return { ...result, isUpdate: true }
}
