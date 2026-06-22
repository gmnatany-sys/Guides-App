import { createBrowserClient } from '@supabase/ssr'
import { normalizeSupabaseUrl } from './url'

// Base URL only (no /rest/v1). Sourced from APP_SUPABASE_URL via normalizeSupabaseUrl.
const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_JWT_8!

export function createClient() {
  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  )
}
