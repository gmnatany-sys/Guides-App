import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeSupabaseUrl } from './url'

/**
 * Always create a new client within each function call.
 * Do NOT use module-level constants for env vars — Next.js dev server can
 * reload .env mid-flight (vm:files_synced), which causes constants captured
 * at module init to hold undefined and breaks auth silently.
 */
export async function createClient() {
  // Read env vars fresh on every call so a dev-server env reload never
  // causes a stale/undefined value to reach Supabase.
  const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
  const SUPABASE_ANON_KEY = process.env.JWT_8!

  const cookieStore = await cookies()

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component — safe to ignore.
          // The proxy handles session refresh via response cookies.
        }
      },
    },
  })
}
