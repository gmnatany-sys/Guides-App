import { NAV_ITEMS } from '@/lib/nav-config'
import { AdminSidebarInner } from './admin-sidebar-inner'
import { getCurrentUser } from '@/lib/auth'

// Server Component — fetches the current user once per render (React cache()
// in getCurrentUser ensures a single Supabase call even if other components
// on the same page also call it). Passes identity down to the client inner.
export async function AdminSidebar() {
  const user = await getCurrentUser()
  return (
    <AdminSidebarInner
      navItems={NAV_ITEMS}
      user={user ? { full_name: user.full_name, email: user.email, role: user.role } : null}
    />
  )
}
