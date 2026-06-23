import { OpenDatesManager } from '@/components/open-dates-manager'
import { PermissionGate } from '@/components/permission-gate'

export default function OpenDatesPage() {
  return (
    <PermissionGate permissions={['open_dates_view_access']}>
      <OpenDatesManager />
    </PermissionGate>
  )
}
