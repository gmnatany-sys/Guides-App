import { NAV_ITEMS } from '@/lib/nav-config'
import { AdminSidebarInner } from './admin-sidebar-inner'
import { getCurrentUser } from '@/lib/auth'

// Server Component — fetches the current user once per render (React cache()
// in getCurrentUser ensures a single Supabase call even if other components
// on the same page also call it). Filters nav items by the user's enabled
// permissions before passing them down — no extra fetches, no client-side logic.
export async function AdminSidebar() {
  const user = await getCurrentUser()

  // Filter nav items to only those where the user holds at least one of the
  // required permission keys.  If getCurrentUser() failed (returns null), fall
  // back to the full list so navigation never breaks on a transient auth error.
  const visibleNavItems = user
    ? NAV_ITEMS.filter((item) =>
        item.permissions.some((key) => user.permissions.includes(key))
      )
    : NAV_ITEMS

  return (
    <AdminSidebarInner
      navItems={visibleNavItems}
      user={user ? { full_name: user.full_name, email: user.email, role: user.role } : null}
    />
  )
}
