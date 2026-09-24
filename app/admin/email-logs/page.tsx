import { getCurrentUser } from '@/lib/auth'
import EmailLogsClient from './email-logs-client'
export default async function EmailLogsPage() {
  const user=await getCurrentUser()
  return <EmailLogsClient canSend={user?.permissions.includes('email_logs_manage_access') ?? false} />
}
