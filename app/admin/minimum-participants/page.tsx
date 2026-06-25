import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'
import MinimumParticipantsClient from './minimum-participants-client'

// RSC wrapper: derives canAction server-side (no client trust).
// getCurrentUser() is deduplicated by React.cache() within the same render
// as the layout — zero extra DB round trips.
export default async function MinimumParticipantsPage() {
  const user = await getCurrentUser()
  const canAction = hasPermission(user, 'minimum_participants_action_access')
  return <MinimumParticipantsClient canAction={canAction} />
}
