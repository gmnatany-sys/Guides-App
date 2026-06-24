// Server-only. Never import this from client components or expose to the browser.
// Used exclusively for internal system operations that must bypass RLS and succeed
// regardless of the calling user's session (e.g. syncMinimumParticipantsForTourDate).
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { normalizeSupabaseUrl } from './url'

const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
const SERVICE_ROLE_KEY = process.env.APP_SUPABASE_SERVICE_ROLE_KEY

export function createServiceClient() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error('APP_SUPABASE_SERVICE_ROLE_KEY is not set')
  }
  return createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
