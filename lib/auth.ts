'use server'

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export interface CurrentUser {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'operation' | 'agent' | 'supplier'
  active: boolean
  permissions: string[]
}

/**
 * Returns the currently authenticated user with their enabled permissions,
 * or null if not logged in / not found in app_users / inactive.
 * Cached per request via React cache() so multiple callers in one render
 * do not fire redundant DB queries.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user?.email) {
      return null
    }

    const { data: appUser, error: userError } = await supabase
      .from('app_users')
      .select('id, full_name, email, role, active')
      .ilike('email', user.email)
      .maybeSingle()

    if (userError || !appUser || !appUser.active) {
      return null
    }

    const { data: perms } = await supabase
      .from('user_permissions')
      .select('permission_key')
      .eq('user_id', appUser.id)
      .eq('enabled', true)

    return {
      id: appUser.id,
      full_name: appUser.full_name,
      email: appUser.email,
      role: appUser.role,
      active: appUser.active,
      permissions: (perms ?? []).map((p) => p.permission_key),
    }
  } catch {
    return null
  }
})

// Sync permission helpers live in lib/auth-utils.ts to avoid 'use server' conflicts.
// Import { hasPermission, hasAnyPermission } from '@/lib/auth-utils' instead.
