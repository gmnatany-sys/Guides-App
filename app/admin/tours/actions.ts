'use server'
import {requirePermission} from '@/lib/authorization'
import {getServiceRoleClient} from '@/lib/supabase-admin'
import {refreshBookingPages} from '@/lib/booking-workflows'
import {revalidatePath} from 'next/cache'

export async function fetchTourManagement() {
  await requirePermission('tours_manage_access')
  const service=getServiceRoleClient()
  const [tours,guides,assignments]=await Promise.all([
    service.from('tours').select('*').order('name'),
    service.from('app_users').select('id,full_name,active').eq('role','supplier').order('full_name'),
    service.from('guide_tours').select('*').eq('active',true),
  ])
  if(tours.error||guides.error||assignments.error)throw new Error('Unable to load tour management.')
  return {tours:tours.data??[],guides:guides.data??[],assignments:assignments.data??[]}
}

export async function saveTour(id:string|null,form:FormData) {
  const actor=await requirePermission('tours_manage_access')
  const input={name:String(form.get('name')??''),description:String(form.get('description')??''),max_capacity:Number(form.get('max_capacity')),min_participants:Number(form.get('min_participants')),active:form.get('active')==='on',default_guide_user_id:String(form.get('default_guide_user_id')??'')}
  if(!Number.isSafeInteger(input.max_capacity)||!Number.isSafeInteger(input.min_participants))return {success:false,error:'Capacity and minimum must be whole numbers.'}
  const {error}=await getServiceRoleClient().rpc('booking_save_tour',{p_actor:actor.id,p_id:id,p_input:input,p_guides:form.getAll('guide_ids').map(String)})
  if(error)return {success:false,error:error.message}
  refreshBookingPages();revalidatePath('/admin/tours')
  return {success:true}
}
