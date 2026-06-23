import { getCurrentUser } from '@/lib/auth'
import { AccessDenied } from '@/components/access-denied'
import type { ReactNode } from 'react'

interface PermissionGateProps {
  /** At least one of these permission keys must be present. */
  permissions: string[]
  children: ReactNode
}

/**
 * Server Component gate for page-level permission enforcement.
 *
 * Rules:
 * - If the user is not authenticated, getCurrentUser() returns null.
 *   The proxy handles unauthenticated requests (redirects to /login) before
 *   this component ever renders, so null here means a transient failure —
 *   show Access Denied rather than redirecting again.
 * - If authenticated but missing all required permissions, show Access Denied.
 * - Session remains stable. Sidebar remains visible. No redirect.
 * - getCurrentUser() is React-cached — zero extra DB calls when the sidebar
 *   already called it in the same render tree.
 */
export async function PermissionGate({ permissions, children }: PermissionGateProps) {
  const user = await getCurrentUser()

  const allowed = user
    ? permissions.some((key) => user.permissions.includes(key))
    : false

  if (!allowed) {
    return <AccessDenied />
  }

  return <>{children}</>
}
