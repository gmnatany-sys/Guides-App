import { getCurrentUser } from '@/lib/auth'
import { hasAnyPermission } from '@/lib/auth-utils'
import { AccessDenied } from '@/components/access-denied'

export default async function MinimumParticipantsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  // Phase 1: allow access via new key OR either legacy key so existing users
  // are not locked out before admin assigns minimum_participants_view_access.
  // Phase 2 (after assignment): remove the two legacy keys from this list.
  if (!hasAnyPermission(user, [
    'minimum_participants_view_access',
    'reservations_view_access',
    'supplier_confirmation_view',
  ])) {
    return <AccessDenied />
  }
  return <>{children}</>
}
