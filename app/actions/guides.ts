'use server'
import { requirePermission } from '@/lib/authorization'
import { getServiceRoleClient } from '@/lib/supabase-admin'

export async function fetchGuideChoices(tourId?: string) {
  const actor = await requirePermission('booking_form_access','availability_view_access','supplier_confirmation_view','availability_calendar_manage_access','open_dates_view_access','tours_manage_access')
  const service = getServiceRoleClient()
  let query = service.from('app_users').select('id,full_name').eq('role','supplier').eq('active',true).order('full_name')
  if (actor.role === 'supplier') query=query.eq('id',actor.id)
  let defaultGuide: string | null = null
  if (tourId) {
    const [{data,error},{data:tour,error:tourError}]=await Promise.all([
      service.from('guide_tours').select('guide_user_id').eq('tour_id',tourId).eq('active',true),
      service.from('tours').select('default_guide_user_id').eq('id',tourId).single(),
    ])
    if(error || tourError) throw new Error('Unable to load guides for this tour.')
    if(!data?.length)return {guides:[],defaultGuide:null}
    query=query.in('id',data.map(row=>row.guide_user_id)); defaultGuide=tour.default_guide_user_id
  }
  const {data,error}=await query
  if(error)throw new Error('Unable to load guides.')
  const guides=data ?? []
  return {guides,defaultGuide:guides.some(g=>g.id===defaultGuide)?defaultGuide:guides[0]?.id ?? null}
}
