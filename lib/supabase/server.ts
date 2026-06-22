import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizeSupabaseUrl } from './url'

// Use APP_SUPABASE_URL (base URL only). normalizeSupabaseUrl strips any trailing
// slash or accidental /rest/v1 suffix, and falls back to the correct project if unset.
const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
const SUPABASE_ANON_KEY = process.env.JWT_8

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
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
            // The "setAll" method was called from a Server Component.
            // This can be ignored if you have proxy refreshing
            // user sessions.
          }
        },
      },
    },
  )
}
