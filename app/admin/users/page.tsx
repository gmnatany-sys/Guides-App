import { PermissionGate } from '@/components/permission-gate'
import UsersPageClient from './page-client'

export default function UsersPage() {
  return (
    <PermissionGate permissions={['users_manage_access']}>
      <UsersPageClient />
    </PermissionGate>
  )
}
