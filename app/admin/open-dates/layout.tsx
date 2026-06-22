import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'
import { AccessDenied } from '@/components/access-denied'

export default async function OpenDatesLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  // /admin/open-dates lists open dates; /admin/open-dates/new is the calendar manager.
  // Either open_dates_view_access or availability_calendar_manage_access allows entry.
  if (
    !hasPermission(user, 'open_dates_view_access') &&
    !hasPermission(user, 'availability_calendar_manage_access')
  ) {
    return <AccessDenied />
  }
  return <>{children}</>
}
