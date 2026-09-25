import 'server-only'
import type { CurrentUser } from './auth'
import { getServiceRoleClient } from '@/lib/supabase-admin'

export async function toursForActor(actor: CurrentUser, activeOnly = false) {
  let query = getServiceRoleClient().from('tours').select('*').order('name')
  if (activeOnly) query = query.eq('active', true)
  if (actor.role === 'supplier') {
    const { data, error } = await getServiceRoleClient().from('guide_tours').select('tour_id').eq('guide_user_id', actor.id).eq('active', true)
    if (error) throw new Error('Unable to verify assigned tours.')
    if (!data?.length) return { data: [], error: null }
    query = query.in('id', data.map(row => row.tour_id))
  }
  return query
}

export async function assertDateAccess(actor: CurrentUser, dateIds: string[]) {
  const unique = [...new Set(dateIds)]
  if (!unique.length) return
  if (unique.length > 500) throw new Error('Select no more than 500 departures.')
  const { data, error } = await getServiceRoleClient().from('tour_dates').select('id').in('id', unique)
    .match(actor.role === 'supplier' ? { guide_user_id: actor.id } : {})
  if (error || data?.length !== unique.length) throw new Error('One or more departures are outside your access.')
}
