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
 * Resolve the current route for log context.
 * Reads headers in priority order. Falls back to 'unknown'.
 * Must be called outside of React.cache() to get the correct per-request value.
 */
async function resolveRoute(): Promise<string> {
  const hdrs = await headers()
  return (
    hdrs.get('x-invoke-path') ??
    hdrs.get('x-forwarded-path') ??
    hdrs.get('next-url') ??
    hdrs.get('referer') ??
    'unknown'
  )
}

/**
 * Cached inner implementation — keyed by route so cache() deduplicates
 * within a single page render while still logging the correct route.
 * Do not call this directly — use getCurrentUser() instead.
 */
const _getCurrentUserCached = cache(async (route: string, callId: string): Promise<CurrentUser | null> => {
  try {
    const t0 = Date.now()

    console.log(`[v0] getCurrentUser START callId=${callId} route=${route}`)

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

/**
 * Public entry point. Reads the route outside cache() so the label is always
 * accurate for the current request, then delegates to the cached inner function.
 * The callId is a short timestamp+random suffix — enough to correlate log lines
 * from the same call and count how many times it fires per page load.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const route = await resolveRoute()
  const callId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  return _getCurrentUserCached(route, callId)
}

// Sync permission helpers live in lib/auth-utils.ts to avoid 'use server' conflicts.
// Import { hasPermission, hasAnyPermission } from '@/lib/auth-utils' instead.
