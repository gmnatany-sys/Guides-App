'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { cn } from '@/lib/utils'
import { logoutAction } from '@/app/login/actions'
import type { NavItem } from '@/lib/nav-config'

interface AdminSidebarInnerProps {
  navItems: NavItem[]
  user: {
    full_name: string
    email: string
    role: string
  }
}

export function AdminSidebarInner({ navItems, user }: AdminSidebarInnerProps) {
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function handleLogout() {
    startTransition(async () => {
      await logoutAction()
    })
  }

  return (
    <aside className="w-64 border-r border-border bg-card min-h-screen p-6 flex flex-col">
      {/* Brand */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Japan Tours</h1>
        <p className="text-xs text-muted-foreground">Admin Dashboard</p>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className={cn(
              'px-3 py-2 rounded-md text-sm font-medium transition-colors',
              pathname === item.href
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* User identity + logout */}
      <div className="mt-6 pt-6 border-t border-border flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground truncate">{user.full_name}</span>
          <span className="text-xs text-muted-foreground truncate">{user.email}</span>
          <span className="text-xs text-muted-foreground capitalize">{user.role}</span>
        </div>
        <button
          onClick={handleLogout}
          disabled={isPending}
          className="w-full h-8 rounded-md border border-border text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
