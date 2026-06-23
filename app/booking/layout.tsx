// AUTH_ENFORCEMENT_ENABLED = false
import { AdminSidebar } from '@/components/admin-sidebar'

export default async function BookingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1">{children}</main>
    </div>
  )
}
