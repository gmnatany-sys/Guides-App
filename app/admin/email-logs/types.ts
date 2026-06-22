// Shared types for the Email Logs admin page and its server actions.
// Kept in a separate (non-'use server') module because files with the
// 'use server' directive may only export async functions.

export type CriticalEmailType = 'NEW_BOOKING' | 'CONFIRMED' | 'NOT_CONFIRMED' | 'CANCELLED'

export interface MissingEmailItem {
  reservationId: string
  voucherNumber: string
  docketNumber: string
  leadPassengerName: string
  missingEmailType: CriticalEmailType
  reservationStatus: string
}

export interface SafetyCheckResult {
  success: boolean
  error?: string
  counts: {
    missingNewBooking: number
    missingConfirmed: number
    missingNotConfirmed: number
    missingCancelled: number
    errorEmails: number
    pendingEmails: number
  }
  missing: MissingEmailItem[]
}

export interface CreateMissingResult {
  success: boolean
  error?: string
  created: number
  sentPending: number
  retriedFailed: number
  failed: number
  skipped: number
  details: string[]
}
