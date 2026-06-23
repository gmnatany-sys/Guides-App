import { PermissionGate } from '@/components/permission-gate'
import SupplierAvailabilityPageClient from './page-client'

export default function SupplierAvailabilityPage() {
  return (
    <PermissionGate permissions={['supplier_confirmation_view']}>
      <SupplierAvailabilityPageClient />
    </PermissionGate>
  )
}
