import { PermissionGate } from '@/components/permission-gate'
import BookingPageClient from './page-client'

export default function BookingPage() {
  return (
    <PermissionGate permissions={['booking_form_access']}>
      <BookingPageClient />
    </PermissionGate>
  )
}
