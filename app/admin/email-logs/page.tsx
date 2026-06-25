'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { 
  fetchEmailLogs, 
  sendPendingEmailLogs, 
  getPendingEmailCount
} from './actions'
import type { EmailLog } from '@/lib/types'

export default function EmailLogsPage() {
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [logsResult, countResult] = await Promise.all([
        fetchEmailLogs(),
        getPendingEmailCount()
      ])
      setEmailLogs(logsResult.emailLogs as EmailLog[])
      setError(logsResult.error)
      setPendingCount(countResult.count)
    } catch (err) {
      console.error('[v0] email-logs loadData failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load email logs.')
    } finally {
      setLoading(false)
    }
  }

  const handleSendPending = async (testMode: boolean) => {
    setSending(true)
    setMessage(null)
    try {
      const result = await sendPendingEmailLogs(testMode)
      if (result.success) {
        setMessage({ type: 'success', text: result.message || `Sent ${result.sent} email(s), ${result.failed} failed.` })
        loadData()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to send emails.' })
      }
    } catch (err) {
      console.error('[v0] email-logs handleSendPending failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send emails.' })
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Compact format: "Jun 16, 14:30" — fits 130px column without wrapping.
  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr)
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    return `${date}, ${time}`
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Pending</Badge>
      case 'SENT':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Sent</Badge>
      case 'FAILED':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Failed</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'NEW_BOOKING':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">New Booking</Badge>
      case 'CONFIRMED':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Confirmed</Badge>
      case 'NOT_CONFIRMED':
        return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Not Confirmed</Badge>
      case 'CANCELLED':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Cancelled</Badge>
      default:
        return <Badge variant="outline">{type}</Badge>
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Email Logs</h1>
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Loading email logs...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-6">Email Logs</h1>
        <Card>
          <CardContent className="p-6">
            <p className="text-red-600">Error: {error}</p>
            <Button onClick={loadData} variant="outline" className="mt-4">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Email Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View the latest email notifications sent by the system.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 && (
            <>
              <Button 
                onClick={() => handleSendPending(true)} 
                disabled={sending}
                variant="outline"
                className="border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                {sending ? 'Sending...' : 'Send 1 (Test)'}
              </Button>
              <Button 
                onClick={() => handleSendPending(false)} 
                disabled={sending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {sending ? 'Sending...' : `Send All Pending (${pendingCount})`}
              </Button>
            </>
          )}
          <Button onClick={loadData} variant="outline" disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-md ${
          message.type === 'success' 
            ? 'bg-green-50 text-green-800 border border-green-200' 
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <Card>
        {/* overflow-x-auto kept as safety net for very small screens */}
        <div className="overflow-x-auto">
          {/* table-fixed is required for max-w-* on th/td to be honoured */}
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[115px]">Created</TableHead>
                <TableHead className="w-[110px]">Type</TableHead>
                <TableHead className="w-[80px]">Voucher</TableHead>
                <TableHead className="w-[150px]">From</TableHead>
                <TableHead className="w-[150px]">To</TableHead>
                <TableHead className="w-[110px]">CC</TableHead>
                <TableHead className="w-[180px]">Subject</TableHead>
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead className="w-[120px]">Error</TableHead>
                <TableHead className="w-[115px]">Sent At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emailLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    No email logs found.
                  </TableCell>
                </TableRow>
              ) : (
                emailLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </TableCell>
                    <TableCell>
                      {getTypeBadge(log.email_type)}
                    </TableCell>
                    <TableCell className="text-sm truncate" title={log.reservations?.voucher_number || log.reservations?.reservation_number || '-'}>
                      {log.reservations?.voucher_number || log.reservations?.reservation_number || '-'}
                    </TableCell>
                    <TableCell className="text-sm truncate" title={log.from_email}>
                      {log.from_email}
                    </TableCell>
                    <TableCell className="text-sm truncate" title={log.to_email}>
                      {log.to_email}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate" title={log.cc || '-'}>
                      {log.cc || '-'}
                    </TableCell>
                    <TableCell className="text-sm truncate" title={log.subject}>
                      {log.subject}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(log.status)}
                    </TableCell>
                    <TableCell className="text-sm text-red-600 truncate" title={log.error_message || ''}>
                      {log.error_message || '-'}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {log.sent_at ? formatDateTime(log.sent_at) : '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}
