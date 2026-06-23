import { PermissionGate } from '@/components/permission-gate'
import EmailLogsPageClient from './page-client'

export default function EmailLogsPage() {
  return (
    <PermissionGate permissions={['email_logs_view_access']}>
      <EmailLogsPageClient />
    </PermissionGate>
  )
}
