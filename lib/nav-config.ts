// Central mapping from sidebar links to the permission(s) required to see them.
// The sidebar reads this at render time; route guards use the same keys.

export interface NavItem {
  href: string
  label: string
  /** At least one of these permission_keys must be enabled to show the link. */
  permissions: string[]
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/admin/tours',                  label: 'Tours',                        permissions: ['tours_manage_access'] },
  { href: '/admin/open-dates',             label: 'Open Dates',                   permissions: ['open_dates_view_access'] },
  { href: '/admin/open-dates/new',         label: 'Availability Calendar',        permissions: ['availability_calendar_manage_access'] },
  { href: '/admin/reservations',           label: 'Reservations',                 permissions: ['reservations_view_access'] },
  { href: '/admin/minimum-participants',   label: 'Minimum Participants',         permissions: ['minimum_participants_view_access', 'reservations_view_access', 'supplier_confirmation_view'] },
  { href: '/admin/email-logs',             label: 'Email Logs',                   permissions: ['email_logs_view_access'] },
  // { href: '/admin/diagnostics',         label: 'Diagnostics',                  permissions: ['email_logs_view_access'] },   // hidden — dev/ops tool, accessible via direct URL
  { href: '/admin/users',                  label: 'Users',                        permissions: ['users_manage_access'] },
  { href: '/availability',                 label: 'Availability Calendar (View)', permissions: ['availability_view_access'] },
  // { href: '/supplier/availability',     label: 'Supplier Availability',        permissions: ['supplier_confirmation_view'] },  // hidden — accessible via direct URL
  { href: '/supplier/confirm',             label: 'Supplier Confirmation',        permissions: ['supplier_confirmation_view'] },
  { href: '/booking',                      label: 'Booking Form',                 permissions: ['booking_form_access'] },
]
