import { getCurrentUser } from '@/lib/auth'
import BookingClient from './booking-client'

// Thin RSC wrapper: calls getCurrentUser() (deduplicated by React.cache() —
// same render as the layout, zero extra DB round trips) and passes identity
// props to BookingClient.
//
// BookingClient uses these props to:
//   - initialise selectedAgentId to currentUserId for agents
//   - show a read-only name display instead of the agent dropdown for agents
//   - skip the client-side agent validation for agents
//
// submitBooking also enforces actor.role === 'agent' → agentUserId = actor.id
// server-side, so client tampering is not possible.
export default async function BookingPage() {
  const user = await getCurrentUser()
  return (
    <BookingClient
      currentUserId={user?.id ?? ''}
      currentUserRole={user?.role ?? ''}
      currentUserName={user?.full_name ?? ''}
    />
  )
}
