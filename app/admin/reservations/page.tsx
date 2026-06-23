import { PermissionGate } from '@/components/permission-gate'
import ReservationsPageClient from './page-client'

export default function ReservationsPage() {
  return (
    <PermissionGate permissions={['reservations_view_access']}>
      <ReservationsPageClient />
    </PermissionGate>
  )
}
