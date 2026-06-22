// AUTH_ENFORCEMENT_ENABLED = false
// Sidebar shows all nav items with no user fetch or permission filtering.
import { NAV_ITEMS } from '@/lib/nav-config'
import { AdminSidebarInner } from './admin-sidebar-inner'

export function AdminSidebar() {
  return (
    <AdminSidebarInner
      navItems={NAV_ITEMS}
      user={{ full_name: 'Admin', email: '', role: 'admin' }}
    />
  )
}
