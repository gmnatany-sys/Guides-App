import { getCurrentUser } from '@/lib/auth'
import SupplierConfirmClient from './supplier-confirm-client'

// Thin RSC wrapper: getCurrentUser() is deduplicated by React.cache() within
// the same render as the layout — zero extra DB round trips. Permissions passed
// as initialPermissions to the client component, eliminating the
// getMyPermissions() useEffect server action that previously fired after mount.
export default async function SupplierConfirmPage() {
  const user = await getCurrentUser()
  const initialPermissions = user?.permissions ?? []
  return <SupplierConfirmClient initialPermissions={initialPermissions} />
}
