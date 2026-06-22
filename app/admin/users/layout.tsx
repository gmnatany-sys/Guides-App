import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/auth-utils'
import { AccessDenied } from '@/components/access-denied'

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  console.log('[v0] /admin/users guard: entering')
  const user = await getCurrentUser()
  const hasSession = !!user
  const hasPerm = hasPermission(user, 'users_manage_access')
  console.log('[v0] /admin/users guard: session=', hasSession, 'email=', user?.email ?? 'none', 'users_manage_access=', hasPerm)
  if (!hasPerm) {
    console.log('[v0] /admin/users guard: ACCESS DENIED — no redirect, showing inline denial')
    return <AccessDenied />
  }
  console.log('[v0] /admin/users guard: ACCESS GRANTED — rendering page')
  return <>{children}</>
}
