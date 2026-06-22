// Single source of truth for the Supabase base URL.
//
// The Supabase JS client expects the PROJECT BASE URL only
// (e.g. https://handniwiwphefterousk.supabase.co) and appends /rest/v1, /auth/v1,
// etc. itself. Passing a URL that already includes /rest/v1 breaks every request,
// so this helper strips any such suffix (and trailing slashes) defensively.
//
// We intentionally read APP_SUPABASE_URL (NOT NEXT_PUBLIC_SUPABASE_URL) and fall
// back to the correct active project if the env var is missing or empty.
const FALLBACK_SUPABASE_URL = 'https://handniwiwphefterousk.supabase.co'

export function normalizeSupabaseUrl(rawUrl?: string | null): string {
  const value = (rawUrl ?? '').trim()
  if (!value) {
    return FALLBACK_SUPABASE_URL
  }

  // Remove any path (e.g. /rest/v1, /rest/v1/, /auth/v1) and trailing slashes,
  // keeping only the origin (protocol + host).
  try {
    const parsed = new URL(value)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    // Not a fully-qualified URL; strip a trailing /rest/v1(...) and slashes manually.
    return value.replace(/\/rest\/v1.*$/i, '').replace(/\/+$/, '')
  }
}
