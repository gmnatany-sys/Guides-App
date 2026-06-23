import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'
import MinimumParticipantsClient from './minimum-participants-client'

export default async function MinimumParticipantsPage() {
  const user = await getCurrentUser()
  const canAct = hasPermission(user, 'minimum_participants_action_access')
  return <MinimumParticipantsClient canAct={canAct} />
}
