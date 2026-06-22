import { AdminSidebar } from '@/components/admin-sidebar'
import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'
import { AccessDenied } from '@/components/access-denied'

export default async function SupplierLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  // /supplier covers both /supplier/availability and /supplier/confirm.
  // supplier_confirmation_view is the common required permission.
  if (!hasPermission(user, 'supplier_confirmation_view')) {
    return (
      <div className="flex min-h-screen bg-background">
        <AdminSidebar />
        <main className="flex-1 p-8"><AccessDenied /></main>
      </div>
    )
  }
  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
