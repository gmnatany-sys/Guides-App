'use client'

import { useEffect, useState } from 'react'
import { getMyPermissions } from '@/app/actions/permissions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'

export default function SupplierCancelDatesPage() {
  const [canManage, setCanManage] = useState<boolean | null>(null)

  useEffect(() => {
    getMyPermissions().then((perms) =>
      setCanManage(perms.includes('availability_calendar_manage_access'))
    )
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-slate-200">
        <CardContent className="pt-8 pb-8 px-8 text-center space-y-4">
          <p className="text-slate-700 font-medium">
            This page has been replaced by the Availability Calendar.
          </p>
          {canManage === null ? null : canManage ? (
            <Button asChild className="bg-slate-900 hover:bg-slate-800">
              <Link href="/admin/open-dates/new">Go to Availability Calendar</Link>
            </Button>
          ) : (
            <p className="text-sm text-slate-500">
              Please contact an admin to manage availability.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
