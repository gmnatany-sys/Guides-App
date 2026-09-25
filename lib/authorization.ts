import 'server-only'
import { getCurrentUser } from '@/lib/auth'
import { GUIDE_PERMISSIONS } from '@/lib/guide-permissions'

export async function requirePermission(...keys: string[]) {
  const actor = await getCurrentUser()
  if (!actor?.active || !keys.some(key => actor.permissions.includes(key) && (actor.role !== 'supplier' || GUIDE_PERMISSIONS.has(key)))) {
    throw new Error('You do not have permission to perform this action.')
  }
  return actor
}

export function safeSearch(value: string) {
  // PostgREST's filter grammar is not SQL; its separators must not be interpolated.
  return value.trim().replace(/[(),.%_*\\"']/g, ' ').slice(0, 120)
}
