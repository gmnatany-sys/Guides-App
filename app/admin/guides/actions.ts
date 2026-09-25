'use server'
import {requirePermission} from '@/lib/authorization'
import {getServiceRoleClient,findAuthUserByEmail} from '@/lib/supabase-admin'
import {revalidatePath} from 'next/cache'

export async function fetchGuideManagement(){
  await requirePermission('users_manage_access')
  const service=getServiceRoleClient()
  const [users,links]=await Promise.all([
    service.from('app_users').select('id,full_name,email,active,auth_user_id').eq('role','supplier').order('full_name'),
    service.from('guide_tours').select('guide_user_id,tours(name)').eq('active',true),
  ])
  if(users.error||links.error)throw new Error('Unable to load guides.')
  return {guides:(users.data??[]).map(({auth_user_id,...user})=>({...user,loginReady:!!auth_user_id})),assignments:links.data??[]}
}

export async function createGuide(form:FormData){
  const actor=await requirePermission('users_manage_access')
  const full_name=String(form.get('full_name')??'').trim(),email=String(form.get('email')??'').trim().toLowerCase()
  if(!full_name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {success:false,error:'Enter a name and valid email.'}
  const match=await findAuthUserByEmail(email)
  if(match.error)return {success:false,error:match.error}
  const {error}=await getServiceRoleClient().rpc('booking_save_user',{p_actor:actor.id,p_id:null,p_input:{full_name,email,role:'supplier',active:true,auth_user_id:match.user?.id??null}})
  if(error)return {success:false,error:error.message}
  revalidatePath('/admin/guides');revalidatePath('/admin/users');return {success:true}
}
