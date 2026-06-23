import { PermissionGate } from '@/components/permission-gate'
import AvailabilityPageClient from './page-client'

export default function AvailabilityPage() {
  return (
    <PermissionGate permissions={['availability_view_access']}>
      <AvailabilityPageClient />
    </PermissionGate>
  )
}
