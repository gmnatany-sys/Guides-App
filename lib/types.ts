export interface Tour {
  id: string
  name: string
  description: string | null
  active?: boolean
  max_capacity?: number
  created_at: string
  updated_at: string
}

export interface TourDate {
  id: string
  tour_id: string
  tour_date: string
  is_open: boolean
  supplier_status: 'YES' | 'NO' | 'CANCELLED'
  notes: string | null
  created_at: string
  updated_at: string
  tours?: Tour
}

export interface Reservation {
  id: string
  reservation_number: string
  voucher_number: string | null
  lead_passenger_name: string
  whatsapp_number: string | null
  participants: number
  tour_id: string
  tour_date_id: string
  status: 'WAITING FOR CONFIRMATION' | 'CONFIRMED' | 'NOT CONFIRMED' | 'CANCELLED'
  confirmation_number: string | null
  agent_name: string | null
  agent_email: string | null
  internal_notes: string | null
  supplier_response_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  tours?: Tour
  tour_dates?: TourDate
}

export interface AvailableDate {
  id: string
  tour_date: string
  seats_left: number
}

export interface EmailLog {
  id: string
  reservation_id: string | null
  email_type: 'NEW_BOOKING' | 'CONFIRMED' | 'NOT_CONFIRMED' | 'CANCELLED'
  from_email: string
  to_email: string
  cc: string | null
  subject: string
  status: 'PENDING' | 'SENT' | 'FAILED'
  error_message: string | null
  sent_at: string | null
  created_at: string
  reservations?: Reservation
}
