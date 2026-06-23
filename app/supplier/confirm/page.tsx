import { PermissionGate } from '@/components/permission-gate'
import SupplierConfirmPageClient from './page-client'

export default function SupplierConfirmPage() {
  return (
    <PermissionGate permissions={['supplier_confirmation_view']}>
      <SupplierConfirmPageClient />
    </PermissionGate>
  )
}
