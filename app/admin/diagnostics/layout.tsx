import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'
import { AccessDenied } from '@/components/access-denied'

export default async function DiagnosticsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!hasPermission(user, 'email_logs_view_access')) {
    return <AccessDenied />
  }
  return <>{children}</>
}
