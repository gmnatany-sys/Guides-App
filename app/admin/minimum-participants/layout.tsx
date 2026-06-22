import { getCurrentUser } from '@/lib/auth'
import { hasAnyPermission } from '@/lib/auth-utils'
import { AccessDenied } from '@/components/access-denied'

export default async function MinimumParticipantsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!hasAnyPermission(user, ['reservations_view_access', 'supplier_confirmation_view'])) {
    return <AccessDenied />
  }
  return <>{children}</>
}
