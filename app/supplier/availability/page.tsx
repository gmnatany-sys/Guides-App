import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'

/**
 * This route is kept alive so that any saved bookmarks or external links do
 * not produce a 404. The old form is never rendered — visitors see a
 * deprecation notice and are directed to the replacement page.
 */
export default async function SupplierAvailabilityDeprecatedPage() {
  const user = await getCurrentUser()
  const canUseCalendar = user?.permissions.includes('availability_calendar_manage_access') ?? false
  const canViewCalendar = user?.permissions.includes('availability_view_access') ?? false

  const calendarHref = canUseCalendar
    ? '/admin/open-dates/new'
    : canViewCalendar
    ? '/availability'
    : null

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="flex flex-col gap-2 max-w-md">
        <h1 className="text-xl font-semibold text-foreground">
          This page has been replaced by the Availability Calendar.
        </h1>
        <p className="text-sm text-muted-foreground">
          The old Supplier Availability form is no longer in use. Please use
          the Availability Calendar to manage tour dates.
        </p>
      </div>

      {calendarHref ? (
        <Button asChild>
          <Link href={calendarHref}>Go to Availability Calendar</Link>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Please contact an admin to manage availability.
        </p>
      )}
    </div>
  )
}
