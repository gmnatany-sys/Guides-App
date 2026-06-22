import { AdminSidebar } from '@/components/admin-sidebar'
import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'
import { AccessDenied } from '@/components/access-denied'

export default async function BookingLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'booking_form_access')) {
    return (
      <div className="flex min-h-screen">
        <AdminSidebar />
        <main className="flex-1 p-8"><AccessDenied /></main>
      </div>
    )
  }
  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1">{children}</main>
    </div>
  )
}
