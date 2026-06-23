import { PermissionGate } from '@/components/permission-gate'
import { getCurrentUser } from '@/lib/auth'
import MinimumParticipantsPageClient from './page-client'

export default async function MinimumParticipantsPage() {
  const user = await getCurrentUser()
  const canPerformActions = user?.permissions.includes('minimum_participants_action_access') ?? false

  return (
    <PermissionGate permissions={['minimum_participants_view_access']}>
      <MinimumParticipantsPageClient canPerformActions={canPerformActions} />
    </PermissionGate>
  )
}
