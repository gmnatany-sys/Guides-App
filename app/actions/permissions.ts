'use server'

import { getCurrentUser } from '@/lib/auth'

/**
 * Called by client pages once on mount to get the current user's enabled
 * permission keys. Cached per request via getCurrentUser's React cache().
 */
export async function getMyPermissions(): Promise<string[]> {
  const user = await getCurrentUser()
  return user?.permissions ?? []
}
