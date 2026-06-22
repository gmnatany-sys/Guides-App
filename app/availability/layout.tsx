// AUTH_ENFORCEMENT_ENABLED = false
import { AdminSidebar } from '@/components/admin-sidebar'

export default function AvailabilityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
