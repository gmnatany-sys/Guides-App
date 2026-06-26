import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { NAV_ITEMS } from '@/lib/nav-config'

export default async function Page() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const permSet = new Set(user.permissions)
  const firstVisible = NAV_ITEMS.find((item) =>
    item.permissions.some((key) => permSet.has(key))
  )

  redirect(firstVisible?.href ?? '/login')
}
