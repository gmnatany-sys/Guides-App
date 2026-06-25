'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { getServiceRoleClient, findAuthUserByEmail } from '@/lib/supabase-admin'

export interface AppUser {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'operation' | 'agent' | 'supplier'
  active: boolean
  created_at: string
}

export interface UserPermission {
  id: string
  user_id: string
  permission_key: string
  enabled: boolean
}

export type UserRole = 'admin' | 'operation' | 'agent' | 'supplier'

export async function fetchAppUsers(filters?: { role?: string; active?: boolean; search?: string }) {
  const supabase = await createClient()
  
  let query = supabase
    .from('app_users')
    .select('*')
    .order('full_name', { ascending: true })
  
  if (filters?.role && filters.role !== 'all') {
    query = query.eq('role', filters.role)
  }
  
  if (filters?.active !== undefined) {
    query = query.eq('active', filters.active)
  }
  
  if (filters?.search) {
    const searchTerm = filters.search.trim()
    if (searchTerm) {
      query = query.or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
    }
  }
  
  const { data, error } = await query
  
  if (error) {
    console.error('Error fetching app users:', error)
    return { users: [], error: error.message }
  }
  
  return { users: data as AppUser[], error: null }
}

export async function fetchActiveAgents() {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('app_users')
    .select('id, full_name, email, role')
    .eq('active', true)
    .in('role', ['admin', 'operation', 'agent'])
    .order('full_name', { ascending: true })
  
  if (error) {
    console.error('Error fetching active agents:', error)
    return { agents: [], error: error.message }
  }
  
  return { agents: data, error: null }
}

export async function createAppUser(formData: FormData) {
  const fullName = formData.get('full_name') as string
  const email = formData.get('email') as string
  const role = formData.get('role') as string
  
  if (!fullName?.trim() || !email?.trim() || !role) {
    return { success: false, error: 'Please fill in all required fields.' }
  }
  
  const validRoles = ['admin', 'operation', 'agent', 'supplier']
  if (!validRoles.includes(role)) {
    return { success: false, error: 'Invalid role selected.' }
  }
  
  const supabase = await createClient()
  
  const { error } = await supabase.from('app_users').insert({
    full_name: fullName.trim(),
    email: email.trim().toLowerCase(),
    role: role,
    active: true
  })
  
  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'A user with this email already exists.' }
    }
    return { success: false, error: error.message }
  }
  
  revalidatePath('/admin/users')
  return { success: true }
}

export async function updateAppUser(userId: string, formData: FormData) {
  const fullName = formData.get('full_name') as string
  const email = formData.get('email') as string
  const role = formData.get('role') as string
  const active = formData.get('active') === 'true'
  
  if (!fullName?.trim() || !email?.trim() || !role) {
    return { success: false, error: 'Please fill in all required fields.' }
  }
  
  const validRoles = ['admin', 'operation', 'agent', 'supplier']
  if (!validRoles.includes(role)) {
    return { success: false, error: 'Invalid role selected.' }
  }
  
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('app_users')
    .update({
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      role: role,
      active: active
    })
    .eq('id', userId)
  
  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'A user with this email already exists.' }
    }
    return { success: false, error: error.message }
  }
  
  revalidatePath('/admin/users')
  return { success: true }
}

export async function toggleUserActive(userId: string, active: boolean) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('app_users')
    .update({ active })
    .eq('id', userId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  revalidatePath('/admin/users')
  return { success: true }
}

export async function deleteAppUser(userId: string) {
  const supabase = await createClient()
  
  // Check if user has any reservations
  const { data: reservations } = await supabase
    .from('reservations')
    .select('id')
    .eq('created_by_user_id', userId)
    .limit(1)
  
  if (reservations && reservations.length > 0) {
    return { success: false, error: 'Cannot delete user with existing reservations. Deactivate instead.' }
  }
  
  const { error } = await supabase
    .from('app_users')
    .delete()
    .eq('id', userId)
  
  if (error) {
    return { success: false, error: error.message }
  }
  
  revalidatePath('/admin/users')
  return { success: true }
}

// Permission management functions

export async function fetchUserPermissions(userId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('user_permissions')
    .select('*')
    .eq('user_id', userId)
  
  if (error) {
    console.error('Error fetching user permissions:', error)
    return { permissions: [], error: error.message }
  }
  
  return { permissions: data as UserPermission[], error: null }
}

export async function updateUserPermission(userId: string, permissionKey: string, enabled: boolean) {
  const supabase = await createClient()
  
  // Use upsert to create or update the permission
  const { error } = await supabase
    .from('user_permissions')
    .upsert({
      user_id: userId,
      permission_key: permissionKey,
      enabled: enabled,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,permission_key'
    })
  
  if (error) {
    console.error('Error updating user permission:', error)
    return { success: false, error: error.message }
  }
  
  revalidatePath('/admin/users')
  return { success: true }
}

export async function bulkUpdateUserPermissions(userId: string, permissions: { key: string; enabled: boolean }[]) {
  const supabase = await createClient()
  
  // Upsert all permissions at once
  const permissionRecords = permissions.map(p => ({
    user_id: userId,
    permission_key: p.key,
    enabled: p.enabled,
    updated_at: new Date().toISOString()
  }))
  
  const { error } = await supabase
    .from('user_permissions')
    .upsert(permissionRecords, {
      onConflict: 'user_id,permission_key'
    })
  
  if (error) {
    console.error('Error bulk updating user permissions:', error)
    return { success: false, error: error.message }
  }
  
  revalidatePath('/admin/users')
  return { success: true }
}

/**
 * Sets the Supabase Auth password for a given app_users row.
 * If no matching Auth account exists, one is created automatically.
 *
 * Security:
 *   - Re-verifies users_manage_access server-side (belt-and-suspenders over the layout gate).
 *   - Uses the service-role Admin Auth API — no current password required or exposed.
 *   - Password is never stored in app_users or any application table.
 *   - Password is never logged.
 *   - auth.admin.getUserByEmail() does not exist in @supabase/auth-js 2.107.0;
 *     findAuthUserByEmail() uses paginated listUsers() instead.
 */
export async function adminSetUserPassword(
  userId: string,
  newPassword: string,
): Promise<{ success: boolean; error: string | null }> {
  // 1. Server-side permission check
  const actor = await getCurrentUser()
  if (!actor || !actor.permissions.includes('users_manage_access')) {
    return { success: false, error: 'Unauthorized.' }
  }

  // 2. Validate inputs
  if (!userId?.trim()) return { success: false, error: 'Invalid user ID.' }
  if (!newPassword || newPassword.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters.' }
  }

  // 3. Look up target app_users row to get email
  const service = getServiceRoleClient()
  const { data: targetUser, error: userErr } = await service
    .from('app_users')
    .select('email, full_name')
    .eq('id', userId)
    .single()

  if (userErr || !targetUser?.email) {
    return { success: false, error: 'User not found.' }
  }

  // 4. Find the Supabase Auth account by email (paginated — no getUserByEmail in this SDK version)
  const { user: authUser, error: findErr } = await findAuthUserByEmail(targetUser.email)
  if (findErr) return { success: false, error: findErr }

  if (!authUser) {
    // 5a. No Auth account exists — create one with the provided password.
    // email_confirm: true skips the confirmation email for admin-created accounts.
    // Password is passed directly to the Auth API and never stored in app data.
    const { error: createErr } = await service.auth.admin.createUser({
      email: targetUser.email,
      password: newPassword,
      email_confirm: true,
    })
    if (createErr) return { success: false, error: createErr.message }
    console.log(`[v0] adminSetUserPassword: actor=${actor.id} target=${userId} action=created_auth_account`)
    return { success: true, error: null }
  }

  // 5b. Auth account exists — update the password.
  // Password is passed directly to the Auth API and never stored in app data.
  const { error: updateErr } = await service.auth.admin.updateUserById(authUser.id, {
    password: newPassword,
  })
  if (updateErr) return { success: false, error: updateErr.message }

  console.log(`[v0] adminSetUserPassword: actor=${actor.id} target=${userId} action=updated_password`)
  return { success: true, error: null }
}
