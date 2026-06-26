'use server'

import { cache } from 'react'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase-admin'

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

    // Step 1: verify identity.
    //
    // Primary path — getClaims() with ES256 JWK verification:
    //   1. Reads the access_token from the session cookie (local, ~0ms)
    //   2. Decodes the JWT header/payload (local, ~0ms)
    //   3. Fetches the JWK from /.well-known/jwks.json and verifies the
    //      ES256 signature via crypto.subtle (network on first call, then
    //      cached for 10 minutes — effectively ~0ms after warm)
    //   This project uses ES256 (confirmed via JWKS endpoint), so getClaims()
    //   never falls back to a remote getUser() call.
    //
    // Fallback — getUser() remote call:
    //   Used only if getClaims() errors (e.g. expired token, missing session,
    //   or JWK fetch failure). getUser() re-verifies with the Supabase Auth
    //   server and is the safe, authoritative path.
    //
    // Security: both paths produce a server-verified identity before any
    // service-role DB query is executed. The service role client is never
    // used without a confirmed email/id from one of these two paths.

    const tAuth = Date.now()
    const supabase = await createClient()

    let userEmail: string | null = null
    let authMethod = 'getClaims'

    try {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
      if (!claimsError && claimsData?.claims?.email) {
        userEmail = claimsData.claims.email as string
      } else {
        // getClaims returned no email or errored — fall back to getUser()
        authMethod = 'getUser-fallback'
        const { data: { user }, error: getUserError } = await supabase.auth.getUser()
        if (getUserError || !user?.email) {
          console.log(`[v0] getCurrentUser auth failed: ${Date.now() - tAuth}ms method=${authMethod} callId=${callId} route=${route}`)
          return null
        }
        userEmail = user.email
      }
    } catch {
      // Unexpected error in getClaims — fall back to getUser()
      authMethod = 'getUser-fallback'
      const { data: { user }, error: getUserError } = await supabase.auth.getUser()
      if (getUserError || !user?.email) {
        console.log(`[v0] getCurrentUser auth failed: ${Date.now() - tAuth}ms method=${authMethod} callId=${callId} route=${route}`)
        return null
      }
      userEmail = user.email
    }

    console.log(`[v0] getCurrentUser auth: ${Date.now() - tAuth}ms method=${authMethod} callId=${callId} route=${route}`)
    if (!userEmail) return null

    // Step 2: single round trip — app_users joined with user_permissions.
    //
    // PostgREST resolves the nested select via the FK relationship
    // user_permissions.user_id → app_users.id and executes it as one
    // SQL query (a lateral join), not two separate network calls.
    // The enabled=true filter is applied server-side inside the same query.
    //
    // If the FK relationship is not introspected by PostgREST (e.g. missing
    // FK constraint in the schema), the nested select returns an error and
    // we fall back to two sequential queries.
    const service = getServiceRoleClient()
    const tDB = Date.now()

    const { data: appUser, error: userError } = await service
      .from('app_users')
      .select('id, full_name, email, role, active, user_permissions!user_permissions_user_id_fkey(permission_key)')
      .ilike('email', userEmail)
      .eq('user_permissions.enabled', true)
      .maybeSingle()

    // If the nested select worked, user_permissions is an array on appUser.
    // If PostgREST could not resolve the relationship, fall back to two queries.
    const nestedPerms = Array.isArray((appUser as any)?.user_permissions)
      ? (appUser as any).user_permissions
      : null

    if (!userError && appUser && nestedPerms !== null) {
      // Single round trip succeeded.
      console.log(`[v0] getCurrentUser db (1 round trip): ${Date.now() - tDB}ms callId=${callId} route=${route}`)
      console.log(`[v0] getCurrentUser total: ${Date.now() - t0}ms callId=${callId} route=${route}`)

      if (!appUser.active) return null

      return {
        id: appUser.id,
        full_name: appUser.full_name,
        email: appUser.email,
        role: appUser.role,
        active: appUser.active,
        permissions: nestedPerms.map((p: { permission_key: string }) => p.permission_key),
      }
    }

    // Fallback: nested select failed (relationship not available) — two queries.
    console.log(`[v0] getCurrentUser nested select unavailable, falling back to 2 queries callId=${callId} route=${route}`)

    const { data: appUserFb, error: userErrorFb } = await service
      .from('app_users')
      .select('id, full_name, email, role, active')
      .ilike('email', userEmail)
      .maybeSingle()
    console.log(`[v0] getCurrentUser app_users query: ${Date.now() - tDB}ms callId=${callId} route=${route}`)

    if (userErrorFb || !appUserFb) return null
    if (!appUserFb.active) return null

    const tPerms = Date.now()
    const { data: perms } = await service
      .from('user_permissions')
      .select('permission_key')
      .eq('user_id', appUserFb.id)
      .eq('enabled', true)
    console.log(`[v0] getCurrentUser user_permissions query: ${Date.now() - tPerms}ms callId=${callId} route=${route}`)
    console.log(`[v0] getCurrentUser total: ${Date.now() - t0}ms callId=${callId} route=${route}`)

    return {
      id: appUserFb.id,
      full_name: appUserFb.full_name,
      email: appUserFb.email,
      role: appUserFb.role,
      active: appUserFb.active,
      permissions: (perms ?? []).map((p) => p.permission_key),
    }
  } catch (err) {
    console.log(`[v0] getCurrentUser ERROR: ${String(err)}`)
    return null
  }
})

// Sync permission helpers live in lib/auth-utils.ts to avoid 'use server' conflicts.
// Import { hasPermission, hasAnyPermission } from '@/lib/auth-utils' instead.
