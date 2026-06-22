'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  fetchDiagnosticsSummary,
  testSupabaseConnection,
  testResendConfiguration,
  checkProjectReferences,
  type DiagnosticsSummary,
} from './actions'

type TestResult = { ok: boolean; message: string }

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value === null ? '-' : value}</div>
      </CardContent>
    </Card>
  )
}

function TestRow({
  label,
  description,
  result,
  running,
  onRun,
}: {
  label: string
  description: string
  result: TestResult | null
  running: boolean
  onRun: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <p className="text-sm text-muted-foreground">{description}</p>
        {result && (
          <p className={`mt-1 text-sm break-words ${result.ok ? 'text-green-700' : 'text-red-600'}`}>
            {result.message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {result && (
          <Badge variant="outline" className={result.ok ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'}>
            {result.ok ? 'OK' : 'Failed'}
          </Badge>
        )}
        <Button variant="outline" size="sm" onClick={onRun} disabled={running}>
          {running ? 'Running...' : 'Run'}
        </Button>
      </div>
    </div>
  )
}

export default function DiagnosticsPage() {
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const [supabaseTest, setSupabaseTest] = useState<TestResult | null>(null)
  const [resendTest, setResendTest] = useState<TestResult | null>(null)
  const [projectTest, setProjectTest] = useState<TestResult | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  const loadSummary = async () => {
    setLoading(true)
    try {
      const data = await fetchDiagnosticsSummary()
      setSummary(data)
    } catch (err) {
      console.error('[v0] diagnostics loadSummary failed:', err)
      setSummary({
        supabaseProject: 'unknown',
        supabaseUrl: '',
        reservationsLast24h: null,
        pendingEmailLogs: null,
        errorEmailLogs: null,
        openMinimumParticipantAlerts: null,
        error: err instanceof Error ? err.message : 'Failed to load diagnostics.',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
  }, [])

  const runTest = async (
    name: string,
    fn: () => Promise<TestResult>,
    set: (r: TestResult) => void,
  ) => {
    setRunning(name)
    try {
      set(await fn())
    } catch (err) {
      set({ ok: false, message: err instanceof Error ? err.message : 'Test failed.' })
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Diagnostics</h1>
          <p className="text-muted-foreground">
            Lightweight system health checks. Nothing heavy runs automatically.
          </p>
        </div>
        <Button onClick={loadSummary} variant="outline" disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {summary?.error && (
        <div className="p-4 rounded-lg bg-red-50 text-red-800 border border-red-200">
          {summary.error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Supabase Project In Use</CardTitle>
          <CardDescription>The app is wired to a single Supabase project.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-sm">{summary?.supabaseProject ?? '-'}</div>
          <div className="font-mono text-xs text-muted-foreground break-all">{summary?.supabaseUrl}</div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Reservations (last 24h)" value={summary?.reservationsLast24h ?? null} />
        <StatCard label="Pending Email Logs" value={summary?.pendingEmailLogs ?? null} />
        <StatCard label="Error Email Logs" value={summary?.errorEmailLogs ?? null} />
        <StatCard label="Open Min. Participant Alerts" value={summary?.openMinimumParticipantAlerts ?? null} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manual Tests</CardTitle>
          <CardDescription>Run on demand. These never scan large tables.</CardDescription>
        </CardHeader>
        <CardContent className="py-0">
          <TestRow
            label="Test Supabase connection"
            description="Runs a single count-only query against the database."
            result={supabaseTest}
            running={running === 'supabase'}
            onRun={() => runTest('supabase', testSupabaseConnection, setSupabaseTest)}
          />
          <TestRow
            label="Test Resend configuration"
            description="Checks that RESEND_API_KEY is present. Does not send an email."
            result={resendTest}
            running={running === 'resend'}
            onRun={() => runTest('resend', testResendConfiguration, setResendTest)}
          />
          <TestRow
            label="Check project references"
            description="Confirms the app uses the correct Supabase project."
            result={projectTest}
            running={running === 'project'}
            onRun={() => runTest('project', checkProjectReferences, setProjectTest)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
