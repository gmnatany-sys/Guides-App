'use server'

import { cache } from 'react'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { normalizeSupabaseUrl } from '@/lib/supabase/url'

export interface CurrentUser {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'operation' | 'agent' | 'supplier'
  active: boolean
  permissions: string[]
}

/**
 * Service-role client for server-only reads of app_users and user_permissions.
 * Bypasses RLS on these two tables — safe because:
 *   1. This module is 'use server' and never imported by client components.
 *   2. Identity is always verified first via supabase.auth.getUser() with the
 *      session client before this client is used.
 *   3. All queries are scoped to the verified user's email / id.
 * Never expose this client or its key to the browser.
 */
function createServiceRoleClient() {
  const url = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
  const key = process.env.APP_SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('APP_SUPABASE_SERVICE_ROLE_KEY is not set')
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Returns the currently authenticated user with their enabled permissions,
 * or null if not logged in / not found in app_users / inactive.
 * Cached per request via React cache() so multiple callers in one render
 * do not fire redundant DB queries.
 *
 * auth.getUser() uses the session client (anon key + cookie) to verify identity.
 * app_users and user_permissions are read via the service role client to skip RLS.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  try {
    const t0 = Date.now()

    // Resolve the current route path for log context.
    // next/headers is available in RSC and server actions.
    const hdrs = await headers()
    const route = hdrs.get('x-invoke-path') ?? hdrs.get('next-url') ?? 'unknown'

    // Step 1: verify identity via session client (anon key + cookie).
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    console.log(`[v0] getCurrentUser auth.getUser: ${Date.now() - t0}ms — ${route}`)
    if (authError || !user?.email) return null

    // Step 2: read app_users and user_permissions via service role to skip RLS.
    const service = createServiceRoleClient()

    const t1 = Date.now()
    const { data: appUser, error: userError } = await service
      .from('app_users')
      .select('id, full_name, email, role, active')
      .ilike('email', user.email)
      .maybeSingle()
    console.log(`[v0] getCurrentUser app_users query: ${Date.now() - t1}ms — ${route}`)

    if (userError || !appUser) return null
    if (!appUser.active) return null

    const t2 = Date.now()
    const { data: perms } = await service
      .from('user_permissions')
      .select('permission_key')
      .eq('user_id', appUser.id)
      .eq('enabled', true)
    console.log(`[v0] getCurrentUser user_permissions query: ${Date.now() - t2}ms — ${route}`)
    console.log(`[v0] getCurrentUser total: ${Date.now() - t0}ms — ${route}`)

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
