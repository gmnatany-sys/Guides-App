'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { NavItem } from '@/lib/nav-config'

interface AdminSidebarInnerProps {
  navItems: NavItem[]
}

export function AdminSidebarInner({ navItems }: AdminSidebarInnerProps) {
  const pathname = usePathname()

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
    </aside>
  )
}
