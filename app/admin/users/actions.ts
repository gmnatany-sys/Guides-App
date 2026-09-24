'use server'
import { getServiceRoleClient, findAuthUserByEmail } from '@/lib/supabase-admin'
import { requirePermission, safeSearch } from '@/lib/authorization'
import { revalidatePath } from 'next/cache'

export type UserRole = 'admin' | 'operation' | 'agent' | 'supplier'
export interface AppUser { id:string; full_name:string; email:string; role:UserRole; active:boolean; created_at:string }
export interface UserPermission { id:string; user_id:string; permission_key:string; enabled:boolean }

export async function fetchAppUsers(filters?: {role?:string;active?:boolean;search?:string}) {
  await requirePermission('users_manage_access')
  let query=getServiceRoleClient().from('app_users').select('id,full_name,email,role,active,created_at').order('full_name')
  if(filters?.role && filters.role!=='all')query=query.eq('role',filters.role)
  if(filters?.active!==undefined)query=query.eq('active',filters.active)
  if(filters?.search){const term=safeSearch(filters.search);query=query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)}
  const {data,error}=await query
  return {users:(data ?? []) as AppUser[],error:error?.message ?? null}
}
export async function fetchActiveAgents() {
  await requirePermission('users_manage_access','booking_form_access')
  const {data,error}=await getServiceRoleClient().from('app_users').select('id,full_name,email,role').eq('active',true).in('role',['admin','operation','agent']).order('full_name')
  return {agents:data ?? [],error:error?.message ?? null}
}
export async function createAppUser(formData:FormData) {
  const actor=await requirePermission('users_manage_access')
  const input=Object.fromEntries(['full_name','email','role'].map(k=>[k,String(formData.get(k) ?? '').trim()]))
  const {user,error:authError}=await findAuthUserByEmail(input.email)
  if(authError)return {success:false,error:authError}
  const {error}=await getServiceRoleClient().rpc('booking_save_user',{p_actor:actor.id,p_id:null,p_input:{...input,auth_user_id:user?.id ?? null,active:true}})
  if(error)return {success:false,error:error.message}
  revalidatePath('/admin/users');return {success:true}
}
export async function updateAppUser(userId:string,formData:FormData) {
  const actor=await requirePermission('users_manage_access'),service=getServiceRoleClient()
  const input={full_name:String(formData.get('full_name') ?? '').trim(),email:String(formData.get('email') ?? '').trim().toLowerCase(),role:String(formData.get('role') ?? ''),active:formData.get('active')==='true'}
  if(!input.full_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || !['admin','operation','agent','supplier'].includes(input.role))return {success:false,error:'Enter a valid name, email and role.'}
  if(actor.id===userId && !input.active)return {success:false,error:'You cannot deactivate your own account.'}
  const {data:target,error:readError}=await service.from('app_users').select('auth_user_id,email').eq('id',userId).single()
  if(readError || !target)return {success:false,error:'User not found.'}
  // Stable auth identity keeps application access intact even if the second
  // service is temporarily unavailable during a contact-email change.
  if(target.auth_user_id && target.email.toLowerCase()!==input.email) {
    const {error}=await service.auth.admin.updateUserById(target.auth_user_id,{email:input.email,email_confirm:true})
    if(error)return {success:false,error:error.message}
  }
  const {error}=await service.rpc('booking_save_user',{p_actor:actor.id,p_id:userId,p_input:input})
  if(error)return {success:false,error:'Profile was not saved. The sign-in email may already be updated; retry with the same email. '+error.message}
  revalidatePath('/admin/users');return {success:true}
}
export async function toggleUserActive(userId:string,active:boolean) {
  const actor=await requirePermission('users_manage_access')
  const {error}=await getServiceRoleClient().rpc('booking_save_user',{p_actor:actor.id,p_id:userId,p_input:{active}})
  if(error)return {success:false,error:error.message}
  revalidatePath('/admin/users');return {success:true}
}
export async function deleteAppUser(userId:string) {
  // Preserve attribution and every historical reservation.
  return toggleUserActive(userId,false)
}
export async function fetchUserPermissions(userId:string) {
  await requirePermission('users_manage_access')
  const {data,error}=await getServiceRoleClient().from('user_permissions').select('*').eq('user_id',userId)
  return {permissions:(data ?? []) as UserPermission[],error:error?.message ?? null}
}
export async function updateUserPermission(userId:string,permissionKey:string,enabled:boolean) {
  return bulkUpdateUserPermissions(userId,[{key:permissionKey,enabled}])
}
export async function bulkUpdateUserPermissions(userId:string,permissions:{key:string;enabled:boolean}[]) {
  const actor=await requirePermission('users_manage_access')
  const {error}=await getServiceRoleClient().rpc('booking_save_permissions',{p_actor:actor.id,p_id:userId,p_permissions:permissions})
  if(error)return {success:false,error:error.message}
  revalidatePath('/admin/users');return {success:true}
}
export async function adminSetUserPassword(userId:string,newPassword:string):Promise<{success:boolean;error:string|null}> {
  const actor=await requirePermission('users_manage_access'),service=getServiceRoleClient()
  if(newPassword.length<8)return {success:false,error:'Password must be at least 8 characters.'}
  const {data:target,error}=await service.from('app_users').select('auth_user_id,email').eq('id',userId).single()
  if(error || !target)return {success:false,error:'User not found.'}
  let authId:string|null=target.auth_user_id
  if(!authId) {
    const match=await findAuthUserByEmail(target.email)
    if(match.error)return {success:false,error:match.error}
    authId=match.user?.id ?? null
  }
  if(authId) {
    const {error}=await service.auth.admin.updateUserById(authId,{password:newPassword})
    if(error)return {success:false,error:error.message}
  } else {
    const {data,error}=await service.auth.admin.createUser({email:target.email,password:newPassword,email_confirm:true})
    if(error || !data.user)return {success:false,error:error?.message ?? 'Account creation failed.'}
    authId=data.user.id
  }
  const {error:bindError}=await service.rpc('booking_save_user',{p_actor:actor.id,p_id:userId,p_input:{auth_user_id:authId}})
  return {success:!bindError,error:bindError ? 'Password was set but account linking needs a retry.' : null}
}
