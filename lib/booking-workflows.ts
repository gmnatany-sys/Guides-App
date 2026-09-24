import 'server-only'
import { requirePermission } from '@/lib/authorization'
import { getServiceRoleClient } from '@/lib/supabase-admin'
import { deliverReservationEmails } from '@/lib/email-log'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { processEmailOutbox } from '@/lib/email-log'

export function refreshBookingPages() {
  for (const path of ['/booking','/availability','/supplier/confirm','/supplier/availability','/supplier/cancel-dates',
    '/admin/reservations','/admin/open-dates','/admin/open-dates/new','/admin/minimum-participants','/admin/email-logs']) revalidatePath(path)
}

export async function syncDates(ids: string[]) {
  const service = getServiceRoleClient()
  for (const id of ids) {
    try {
      const { error } = await service.rpc('booking_sync_minimum', { p_id: id })
      if (error) console.error('Minimum participants sync needs retry:', error.code)
    } catch {
      // The booking is already committed. A transport failure must not encourage
      // submitting another booking; the scheduled scan reconciles this date.
      console.error('Minimum participants sync needs retry: transport failure')
    }
  }
}

export async function transitionReservation(id: string, status: string, permission: string, note?: string) {
  const actor = await requirePermission(permission)
  const { data, error } = await getServiceRoleClient().rpc('booking_transition', {
    p_actor: actor.id, p_id: id, p_status: status, p_note: note ?? null,
  })
  if (error || !data) return { success: false, error: error?.message ?? 'Booking was not updated.' }
  await syncDates([data.tour_date_id])
  const delivery = await deliverReservationEmails([id])
  refreshBookingPages()
  return { success: true, reservationUpdated: true, confirmationNumber: data.confirmation_number,
    emailSent: delivery.failed === 0 && delivery.pending === 0, emailError: delivery.error,
    warning: delivery.failed || delivery.pending ? 'Booking saved. Email delivery is pending; check Email Logs.' : undefined }
}

export async function setDates(tourId: string, dates: string[], open: boolean, status: string, permission: string, note?: string) {
  const actor = await requirePermission(permission)
  const { data, error } = await getServiceRoleClient().rpc('booking_set_dates', {
    p_actor: actor.id, p_tour: tourId, p_dates: dates, p_open: open, p_status: status, p_note: note ?? null,
  })
  if (error || !data) return { success: false, error: error?.message ?? 'Dates were not updated.', message: error?.message,
    datesProcessed: 0, reservationsCancelled: 0, emailLogsCreated: 0, successCount: 0, errorCount: dates.length, emailsSent: 0, emailsFailed: 0, errors: [error?.message ?? 'Update failed'] }
  await syncDates(data.dateIds)
  after(async () => { await processEmailOutbox({limit:20}) })
  refreshBookingPages()
  return { success: true, ...data, successCount: data.datesProcessed as number, errorCount: 0,
    emailsSent: 0, emailsFailed: 0, errors: [] as string[],
    message: `${data.datesProcessed} date(s) saved. ${data.reservationsCancelled} booking(s) cancelled. Notifications queued.` }
}
