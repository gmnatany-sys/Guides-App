import { getCurrentUser } from '@/lib/auth'
import { NAV_ITEMS } from '@/lib/nav-config'
import { AdminSidebarInner } from './admin-sidebar-inner'

// Server component — fetches current user once and passes filtered nav to
// the client inner component. No heavy checks in the client.
export async function AdminSidebar() {
  const user = await getCurrentUser()

  // If not logged in (should be caught by proxy, but as a safe fallback)
  if (!user) {
    return null
  }

  // Filter nav items to only those the user has at least one required permission for.
  const permSet = new Set(user.permissions)
  const visibleItems = NAV_ITEMS.filter((item) =>
    item.permissions.some((key) => permSet.has(key))
  )

  return (
    <AdminSidebarInner
      navItems={visibleItems}
      user={{ full_name: user.full_name, email: user.email, role: user.role }}
    />
  )
}
