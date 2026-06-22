'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

// Admin-scoped error boundary. Renders INSIDE app/admin/layout.tsx, so the
// sidebar stays visible and a failing admin page (e.g. /admin/minimum-participants)
// shows an inline error instead of redirecting away to /booking or a blank screen.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[v0] Admin page error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md w-full rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="text-lg font-semibold text-red-800">Something went wrong</h2>
        <p className="mt-2 text-sm text-red-700">
          This page failed to load. You can try again without leaving the admin area.
        </p>
        {error?.message && (
          <p className="mt-2 break-words text-xs font-mono text-red-600">{error.message}</p>
        )}
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button onClick={() => reset()}>Try again</Button>
        </div>
      </div>
    </div>
  )
}
