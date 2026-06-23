import { PermissionGate } from '@/components/permission-gate'
import MinimumParticipantsPageClient from './page-client'

export default function MinimumParticipantsPage() {
  return (
    <PermissionGate permissions={['reservations_view_access', 'supplier_confirmation_view']}>
      <MinimumParticipantsPageClient />
    </PermissionGate>
  )
}
