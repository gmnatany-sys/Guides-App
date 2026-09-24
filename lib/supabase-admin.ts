import 'server-only'
// The server-only import prevents this privileged client from entering browser bundles.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeSupabaseUrl } from '@/lib/supabase/url'

/**
 * Service-role client singleton — one instance per cold start.
 * Extracted from lib/auth.ts so it can be shared without duplicating logic.
 * Callers must authenticate the user and check the required permission first.
 * Safe because:
 *   1. Identity is always verified by the caller before any service-role query.
 *   2. persistSession and autoRefreshToken are disabled — no token leakage.
 */
let _serviceClient: SupabaseClient | null = null

export function getServiceRoleClient() {
  if (_serviceClient) return _serviceClient
  const url = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
  const key = process.env.APP_SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('APP_SUPABASE_SERVICE_ROLE_KEY is not set')
  _serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _serviceClient
}

/**
 * Finds a Supabase Auth user by email address.
 *
 * auth.admin.getUserByEmail() does NOT exist in @supabase/auth-js 2.107.0.
 * listUsers() only accepts { page, perPage } — no email filter parameter.
 * This helper paginates through all auth users (perPage=1000) until a match
 * is found or all pages are exhausted. For typical team sizes (<1000 auth
 * users) this is a single request.
 */
export async function findAuthUserByEmail(email: string): Promise<{ user: { id: string; email?: string } | null; error: string | null }> {
  const service = getServiceRoleClient()
  const normalised = email.toLowerCase()
  let page = 1
  const perPage = 1000

  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage })
    if (error) return { user: null, error: error.message }
    const users = data?.users ?? []
    const match = users.find((u) => u.email?.toLowerCase() === normalised)
    if (match) return { user: match, error: null }
    // Stop when the page returned fewer users than requested — no more pages.
    if (users.length < perPage) return { user: null, error: null }
    page++
  }
}
