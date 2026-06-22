import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'
import { AccessDenied } from '@/components/access-denied'

export default async function SupplierConfirmLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'supplier_confirmation_view')) {
    return <AccessDenied />
  }
  return <>{children}</>
}
