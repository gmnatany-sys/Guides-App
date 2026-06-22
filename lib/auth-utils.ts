import type { CurrentUser } from './auth'

export function hasPermission(user: CurrentUser | null, key: string): boolean {
  if (!user) return false
  return user.permissions.includes(key)
}

export function hasAnyPermission(user: CurrentUser | null, keys: string[]): boolean {
  if (!user) return false
  return keys.some((k) => user.permissions.includes(k))
}
