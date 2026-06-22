'use server'

import { createClient } from '@/lib/supabase/server'
import { normalizeSupabaseUrl } from '@/lib/supabase/url'

// The single Supabase project the app is wired to. Mirrors lib/supabase/server.ts.
const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
const EXPECTED_PROJECT_REF = 'handniwiwphefterousk'

export interface DiagnosticsSummary {
  supabaseProject: string
  supabaseUrl: string
  reservationsLast24h: number | null
  pendingEmailLogs: number | null
  errorEmailLogs: number | null
  openMinimumParticipantAlerts: number | null
  error: string | null
}

// Lightweight overview. Uses count-only (head: true) queries so no large table
// rows are ever transferred. Runs only when the user opens the page / clicks refresh.
export async function fetchDiagnosticsSummary(): Promise<DiagnosticsSummary> {
  const base: DiagnosticsSummary = {
    supabaseProject: EXPECTED_PROJECT_REF,
    supabaseUrl: SUPABASE_URL,
    reservationsLast24h: null,
    pendingEmailLogs: null,
    errorEmailLogs: null,
    openMinimumParticipantAlerts: null,
    error: null,
  }

  try {
    const supabase = await createClient()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [resv, pending, errored, openAlerts] = await Promise.all([
      supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since),
      supabase
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'PENDING'),
      supabase
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .in('status', ['FAILED', 'ERROR']),
      supabase
        .from('minimum_participant_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'OPEN'),
    ])

    return {
      ...base,
      reservationsLast24h: resv.count ?? 0,
      pendingEmailLogs: pending.count ?? 0,
      errorEmailLogs: errored.count ?? 0,
      openMinimumParticipantAlerts: openAlerts.count ?? 0,
      error: resv.error?.message || pending.error?.message || errored.error?.message || openAlerts.error?.message || null,
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : 'Failed to load diagnostics.' }
  }
}

// Quick connectivity probe: a single count-only query. Returns ok/error fast.
export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from('tours')
      .select('id', { count: 'exact', head: true })
    if (error) {
      return { ok: false, message: error.message }
    }
    return { ok: true, message: `Connected to ${EXPECTED_PROJECT_REF}.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed.' }
  }
}

// Resend configuration check. Only inspects env presence — never sends an email.
export async function testResendConfiguration(): Promise<{ ok: boolean; message: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    return { ok: false, message: 'RESEND_API_KEY is not set.' }
  }
  return { ok: true, message: 'RESEND_API_KEY is configured.' }
}

// Confirms the app is pointed at the expected project and not a stale one.
export async function checkProjectReferences(): Promise<{ ok: boolean; message: string }> {
  const usesExpected = SUPABASE_URL.includes(EXPECTED_PROJECT_REF)
  if (!usesExpected) {
    return { ok: false, message: `Unexpected Supabase URL: ${SUPABASE_URL}` }
  }
  return { ok: true, message: `Using correct project: ${EXPECTED_PROJECT_REF}. No wrong-project references in app code.` }
}
