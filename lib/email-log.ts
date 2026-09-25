import 'server-only'
import { randomUUID } from 'node:crypto'
import { Resend } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase-admin'
import { escapeHtml } from '@/lib/html'

type EmailType = 'NEW_BOOKING' | 'CONFIRMED' | 'NOT_CONFIRMED' | 'CANCELLED'
interface EmailLogParams {
  reservationId: string; emailType: EmailType; fromEmail: string; toEmail: string
  cc?: string; subject: string; htmlBody?: string; textBody?: string
}

export function renderEmail(subject: string, reservation?: Record<string, any>, message?: string) {
  const r = reservation
  const rows: [string, unknown][] = r ? [
    ['Voucher Number',r.voucher_number], ['Docket Number',r.reservation_number],
    ['Lead Passenger',r.lead_passenger_name], ['WhatsApp',r.whatsapp_number],
    ['Tour',r.tours?.name], ['Guide',r.guide?.name], ['Tour Date',r.tour_dates?.tour_date], ['Participants',r.participants],
    ['Status',r.status], ['Confirmation Number',r.confirmation_number],
    ['Agent Name',r.agent_name], ['Agent Email',r.agent_email], ['Notes',r.internal_notes],
  ] : []
  const text = [subject, message, ...rows.filter(([,v]) => v != null && v !== '').map(([k,v]) => `${k}: ${v}`),
    'Japan Tours', 'https://v0-admin-dashboard-for-japan.vercel.app/'].filter(Boolean).join('\n\n')
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#21364c">
    <img src="https://v0-admin-dashboard-for-japan.vercel.app/japan-tours-logo.png" alt="Japan Tours" width="200" style="display:block;height:auto">
    <h1>${escapeHtml(subject)}</h1>${message ? `<p>${escapeHtml(message).replace(/\n/g,'<br>')}</p>` : ''}
    <table>${rows.filter(([,v]) => v != null && v !== '').map(([k,v]) => `<tr><th style="text-align:left;padding:8px">${escapeHtml(k)}</th><td style="padding:8px">${escapeHtml(v)}</td></tr>`).join('')}</table>
    <p><a href="https://v0-admin-dashboard-for-japan.vercel.app/">Japan Tours</a></p></div>`
  return { html, text }
}

async function prepareEmail(id: string) {
  const service = getServiceRoleClient()
  const { data: log, error } = await service.from('email_logs').select('*').eq('id',id).single()
  if (error || !log) throw new Error('Email log could not be loaded.')
  if (log.html_body && log.text_body) return log
  if (log.first_attempt_at) throw new Error('Attempted email has no frozen payload. Delivery must be checked manually.')
  // Existing untracked attempts must be reconciled against the provider before retry.
  if (!log.event_key) throw new Error('Legacy email requires delivery review before it can be retried.')
  let snapshot = log.reservation_snapshot
  if (!snapshot && log.reservation_id) {
    const { data, error: reservationError } = await service.from('reservations').select('*,tours(name),tour_dates(tour_date)').eq('id',log.reservation_id).single()
    if (reservationError || !data) throw new Error('Email details could not be verified.')
    snapshot = data
  }
  const body = renderEmail(log.subject, snapshot, log.text_body ?? undefined)
  const { error: saveError } = await service.from('email_logs').update({html_body:body.html,text_body:log.text_body ?? body.text})
    .eq('id',id).is('html_body',null).is('first_attempt_at',null)
  if (saveError) throw new Error('Email payload could not be saved.')
  return log
}

export async function sendEmailLog(id: string): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  let token: string | undefined
  try {
    if (!process.env.RESEND_API_KEY) return { success:false,error:'Email service is not configured. Notification remains queued.' }
    const service = getServiceRoleClient()
    const log = await prepareEmail(id)
    if (log.status === 'SENT') return { success:true,skipped:true }
    token = randomUUID()
    const { data: claimed, error } = await service.rpc('booking_claim_email',{p_id:id,p_token:token})
    if (error) throw new Error('Unable to claim email for delivery.')
    const item = claimed?.[0]
    if (!item) return { success:false,error:'Email is being processed or requires delivery review.' }
    const resend = new Resend(process.env.RESEND_API_KEY)
    // Payload and key stay identical for every retry. An ambiguous attempt is not
    // automatically retried after the provider's 24-hour idempotency window.
    const result = await resend.emails.send({from:item.from_email,to:item.to_email,
      cc:item.cc ? item.cc.split(',').map((v:string)=>v.trim()).filter(Boolean) : undefined,
      subject:item.subject,html:item.html_body,text:item.text_body}, {idempotencyKey:item.event_key})
    if (result.error || !result.data?.id) throw new Error(result.error?.message ?? 'Provider did not confirm delivery.')
    const { data: saved, error: saveError } = await service.from('email_logs').update({status:'SENT',sent_at:new Date().toISOString(),
      provider_id:result.data.id,error_message:null,lease_until:null,lease_token:null}).eq('id',id).eq('lease_token',token).select('id').single()
    if (saveError || !saved) return {success:false,error:'Provider accepted the email; saving the receipt failed. Retry within 23 hours using the same key.'}
    return {success:true}
  } catch (error) {
    // Retain the lease and first-attempt timestamp on uncertainty. Another worker
    // can safely reclaim after expiry, using the same frozen payload and key.
    const message=error instanceof Error ? error.message : 'Email delivery failed.'
    if (token) {
      try {
        await getServiceRoleClient().from('email_logs').update({status:'FAILED',error_message:message})
          .eq('id',id).eq('lease_token',token).neq('status','SENT')
      } catch {
        // The claimed row remains recoverable after its lease expires.
      }
    }
    return {success:false,error:message}
  }
}

export async function createEmailLog(params: EmailLogParams) {
  const service = getServiceRoleClient()
  const {data:id,error} = await service.rpc('booking_queue_email',{p_reservation:params.reservationId,p_type:params.emailType})
  if (error || !id) return {success:false,error:error?.message ?? 'Email was not queued.'}
  if (params.htmlBody && params.textBody) {
    const {error:saveError} = await service.from('email_logs').update({html_body:params.htmlBody,text_body:params.textBody})
      .eq('id',id).is('html_body',null).is('first_attempt_at',null)
    if (saveError) return {success:false,error:'Email body could not be saved.'}
  }
  return sendEmailLog(id)
}

export async function processEmailOutbox(options: {reservationIds?:string[];failedOnly?:boolean;dryRun?:boolean;limit?:number} = {}) {
  const service = getServiceRoleClient()
  let query = service.from('email_logs').select('id').in('status',options.failedOnly?['FAILED','ERROR']:['PENDING','FAILED','ERROR'])
    .not('event_key','is',null)
    .or(`first_attempt_at.is.null,first_attempt_at.gt.${new Date(Date.now()-23*60*60*1000).toISOString()}`)
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order('created_at').limit(Math.min(options.limit ?? 20,50))
  if (options.reservationIds) query=query.in('reservation_id',options.reservationIds)
  const {data,error} = await query
  if(error) return {success:false,sent:0,failed:0,pending:0,error:error.message}
  if(options.dryRun) return {success:true,sent:0,failed:0,pending:data?.length ?? 0}
  let sent=0,failed=0;let lastError:string|undefined
  for(const item of data ?? []) {
    const result=await sendEmailLog(item.id)
    if(result.success) sent++;else {failed++;lastError=result.error}
    // Bound sends to the provider's rate limit. This is an application worker delay.
    await new Promise(resolve=>setTimeout(resolve,600))
  }
  return {success:failed===0,sent,failed,pending:failed,error:lastError}
}

export async function deliverReservationEmails(ids:string[]) {
  try { return await processEmailOutbox({reservationIds:ids,limit:8}) }
  catch { return {success:false,sent:0,failed:1,pending:1,error:'Notification remains queued.'} }
}
