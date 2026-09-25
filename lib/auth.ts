import 'server-only'
import { cache } from 'react'
import { GUIDE_PERMISSIONS } from '@/lib/guide-permissions'
import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase-admin'

export interface CurrentUser {
  id: string; full_name: string; email: string
  role: 'admin' | 'operation' | 'agent' | 'supplier'
  active: boolean; permissions: string[]
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await createClient()
  const { data: { user }, error } = await session.auth.getUser()
  if (error || !user) return null
  const { data: profile, error: profileError } = await getServiceRoleClient().from('app_users')
    .select('id, full_name, email, role, active, user_permissions(permission_key, enabled)')
    .eq('auth_user_id', user.id).maybeSingle()
  if (profileError) throw new Error('Unable to verify account permissions. Please try again.')
  if (!profile?.active) return null
  return { id: profile.id, full_name: profile.full_name, email: profile.email, role: profile.role,
    active: profile.active, permissions: (profile.user_permissions ?? []).filter((p: { enabled: boolean }) => p.enabled)
      .map((p: { permission_key: string }) => p.permission_key).filter((key: string) => profile.role !== 'supplier' || GUIDE_PERMISSIONS.has(key)) }
})
