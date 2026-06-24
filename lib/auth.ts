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
 * Service-role client singleton.
 * Created once per cold start, never per-request. Safe because:
 *   1. This module is 'use server' — never bundled into the client.
 *   2. Identity is always verified first via supabase.auth.getUser().
 *   3. All queries are scoped to the verified user's email / id.
 * Avoids paying the createClient() constructor cost on every request.
 */
let _serviceClient: ReturnType<typeof createServiceClient> | null = null
function getServiceRoleClient() {
  if (_serviceClient) return _serviceClient
  const url = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
  const key = process.env.APP_SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('APP_SUPABASE_SERVICE_ROLE_KEY is not set')
  _serviceClient = createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _serviceClient
}

/**
 * Returns the currently authenticated user with their enabled permissions,
 * or null if not logged in / not found in app_users / inactive.
 *
 * Deduplication: React.cache() takes zero arguments so the cache key is
 * stable — all callers within the same render scope share one result and
 * fire exactly one set of DB queries.
 *
 * Logging: callId and route are generated inside the cached function.
 * Because React.cache() deduplicates by reference identity (zero args),
 * these are generated once per cache-fill, i.e. once per render scope.
 * callId lets you correlate the four log lines for a single execution;
 * route comes from headers() which is stable within one render scope.
 *
 * auth.getUser() uses the session client (anon key + cookie) for identity.
 * app_users and user_permissions use the service role client to skip RLS.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  try {
    const t0 = Date.now()

    // callId correlates log lines from one execution. Generated inside cache()
    // so it is NOT part of the cache key — deduplication is unaffected.
    const callId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

    // Route label for log context. headers() is stable within one render scope.
    const hdrs = await headers()
    const route =
      hdrs.get('x-invoke-path') ??
      hdrs.get('x-forwarded-path') ??
      hdrs.get('next-url') ??
      hdrs.get('referer') ??
      'unknown'

    // Step 1: verify identity via session client (anon key + cookie).
    const tAuth = Date.now()
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    console.log(`[v0] getCurrentUser auth.getUser: ${Date.now() - tAuth}ms callId=${callId} route=${route}`)
    if (authError || !user?.email) return null

    // Step 2: read app_users via service role (bypasses RLS).
    const service = getServiceRoleClient()

    const tUsers = Date.now()
    const { data: appUser, error: userError } = await service
      .from('app_users')
      .select('id, full_name, email, role, active')
      .ilike('email', user.email)
      .maybeSingle()
    console.log(`[v0] getCurrentUser app_users query: ${Date.now() - tUsers}ms callId=${callId} route=${route}`)

    if (userError || !appUser) return null
    if (!appUser.active) return null

    // Step 3: read user_permissions via service role (bypasses RLS).
    const tPerms = Date.now()
    const { data: perms } = await service
      .from('user_permissions')
      .select('permission_key')
      .eq('user_id', appUser.id)
      .eq('enabled', true)
    console.log(`[v0] getCurrentUser user_permissions query: ${Date.now() - tPerms}ms callId=${callId} route=${route}`)

    console.log(`[v0] getCurrentUser total: ${Date.now() - t0}ms callId=${callId} route=${route}`)

    return {
      id: appUser.id,
      full_name: appUser.full_name,
      email: appUser.email,
      role: appUser.role,
      active: appUser.active,
      permissions: (perms ?? []).map((p) => p.permission_key),
    }
  } catch (err) {
    console.log(`[v0] getCurrentUser ERROR: ${String(err)}`)
    return null
  }
})

// Sync permission helpers live in lib/auth-utils.ts to avoid 'use server' conflicts.
// Import { hasPermission, hasAnyPermission } from '@/lib/auth-utils' instead.
