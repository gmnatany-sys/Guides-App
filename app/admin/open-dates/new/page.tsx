import { PermissionGate } from '@/components/permission-gate'
import AvailabilityCalendarPageClient from './page-client'

export default function AvailabilityCalendarPage() {
  return (
    <PermissionGate permissions={['availability_calendar_manage_access']}>
      <AvailabilityCalendarPageClient />
    </PermissionGate>
  )
}
