import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite')
const db=new PGlite()
const file=p=>readFile(new URL('../'+p,import.meta.url),'utf8')
async function executeFile(p) { try { await db.exec(await file(p)) } catch(e) { throw new Error(`${p}: ${e.message}; ${e.detail ?? ''}; position ${e.position ?? ''}`) } }
await executeFile('tests/schema-before.sql')
const agent=randomUUID(),admin=randomUUID(),supplier=randomUUID(),viewer=randomUUID(),inactive=randomUUID(),tour=randomUUID(),otherTour=randomUUID()
const userIds={agent,admin,supplier,viewer,inactive}
for(const [role,id] of Object.entries(userIds)) {
 await db.query('insert into auth.users values($1,$2)',[id,role+'@example.test'])
 await db.query('insert into app_users(id,full_name,email,role,active) values($1,$2,$3,$4,$5)',[id,role,role+'@example.test',role==='agent'?'agent':role==='supplier'?'supplier':'admin',role!=='inactive'])
}
for(const [id,keys] of [[agent,['booking_form_access']],[admin,['booking_form_access','reservations_action_access','availability_calendar_manage_access','minimum_participants_action_access','users_manage_access']],[supplier,['supplier_confirmation_action']],[viewer,['reservations_view_access']],[inactive,['booking_form_access']]])
 for(const key of keys)await db.query('insert into user_permissions(user_id,permission_key,enabled) values($1,$2,true)',[id,key])
await db.query('insert into tours(id,name,max_capacity) values($1,$2,8),($3,$4,8)',[tour,'Test Tour',otherTour,'Other Tour'])
await executeFile('database/prepare-remediation.sql')
await executeFile('database/lockdown-remediation.sql')
const rpc=async(name,args)=>{ const params=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query(`select public.${name}(${params}) as result`,args)).rows[0]?.result }
async function asRole(role,action){await db.exec('set role '+role);try{return await action()}finally{await db.exec('reset role')}}
const service=(name,args)=>asRole('service_role',()=>rpc(name,args))
async function date(label='2030-01-01') {const id=randomUUID();await db.query('insert into tour_dates(id,tour_id,tour_date,is_open,supplier_status) values($1,$2,$3,true,$4)',[id,tour,label,'YES']);return id}
const input=(id,pax=2,extra={})=>({tour_id:tour,tour_date_id:id,reservation_number:'TEST',voucher_number:randomUUID(),lead_passenger_name:'Test <script>alert(1)</script>',whatsapp_number:'+10000000000',participants:pax,agent_user_id:agent,...extra})
const create=(id,pax=2,extra={},actor=agent)=>service('booking_create',[actor,input(id,pax,extra)])

test('all public tables and backend RPCs deny anonymous and direct authenticated access',async()=>{
 for(const role of ['anon','authenticated'])await asRole(role,async()=>{
  for(const table of ['tours','tour_dates','reservations','app_users','user_permissions','email_logs','minimum_participant_alerts','audit_logs'])
   await assert.rejects(db.query('select * from '+table),/permission denied/)
  await assert.rejects(rpc('booking_create',[admin,{}]),/permission denied/)
  await assert.rejects(rpc('booking_claim_email',[randomUUID(),randomUUID()]),/permission denied/)
 })
 const rows=(await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).rows
 assert(rows.every(r=>r.relrowsecurity))
 const audit=await file('database/verify-remediation.sql')
 assert.deepEqual((await db.query(audit)).rows,[])
 await db.exec('grant select on public.reservations to anon')
 try {assert((await db.query(audit)).rows.some(row=>row.issue==='Client grant: anon SELECT on reservations'))}
 finally {await db.exec('revoke select on public.reservations from anon')}
})
test('stable identity backfill and active permission checks',async()=>{
 assert.equal((await db.query('select auth_user_id from app_users where id=$1',[agent])).rows[0].auth_user_id,agent)
 const d=await date('2030-01-02')
 await assert.rejects(create(d,2,{},viewer),/Permission denied/)
 await assert.rejects(create(d,2,{},inactive),/Permission denied/)
 const r=await create(d,2,{agent_user_id:admin})
 assert.equal(r.agent_user_id,agent)
})
test('capacity, integer input, mismatched date and duplicate voucher fail closed',async()=>{
 const d=await date('2030-01-03');const r=await create(d,6)
 await assert.rejects(create(d,3),/Not enough seats/)
 await assert.rejects(create(d,1.5),/invalid input syntax/)
 await assert.rejects(create(d,0),/positive whole/)
 await assert.rejects(create(d,1,{tour_id:otherTour}),/mismatch/)
 await assert.rejects(create(d,1,{selected_tour_date:'2030-01-04'}),/mismatch/)
 await assert.rejects(create(d,1,{voucher_number:r.voucher_number}),/unique/)
 assert.equal((await db.query('select count(*)::int n from reservations where tour_date_id=$1',[d])).rows[0].n,1)
})
test('outbox failure rolls booking and audit back',async()=>{
 const d=await date('2030-01-04')
 await db.exec("create function fail_outbox() returns trigger language plpgsql as $$begin raise exception 'injected outbox outage';end$$;create trigger fail_outbox before insert on email_logs for each row execute function fail_outbox();")
 try {await assert.rejects(create(d),/injected outbox/)}finally{await db.exec('drop trigger fail_outbox on email_logs;drop function fail_outbox()')}
 assert.equal((await db.query('select count(*)::int n from reservations where tour_date_id=$1',[d])).rows[0].n,0)
})
test('confirmations are unique and stable, stale confirmation cannot revive cancellation',async()=>{
 const d=await date('2030-01-05'),r1=await create(d),r2=await create(d)
 const a=await service('booking_transition',[admin,r1.id,'CONFIRMED',null]),b=await service('booking_transition',[supplier,r2.id,'CONFIRMED',null])
 assert.notEqual(a.confirmation_number,b.confirmation_number)
 assert.equal((await service('booking_transition',[admin,r1.id,'CONFIRMED',null])).confirmation_number,a.confirmation_number)
 await service('booking_transition',[admin,r1.id,'CANCELLED',null])
 await assert.rejects(service('booking_transition',[supplier,r1.id,'CONFIRMED',null]),/cancelled booking/)
 await assert.rejects(service('booking_transition',[viewer,r2.id,'CANCELLED',null]),/Permission denied/)
})
test('reactivating a not-confirmed reservation checks capacity',async()=>{
 const d=await date('2030-01-06'),r=await create(d,6)
 await service('booking_transition',[admin,r.id,'NOT CONFIRMED',null]);await create(d,8)
 await assert.rejects(service('booking_transition',[admin,r.id,'CONFIRMED',null]),/Not enough seats/)
})
test('date cancellation is atomic and repeatable even with a pre-existing SENT email',async()=>{
 const d=await date('2030-01-07'),a=await create(d),b=await create(d)
 await db.query("insert into email_logs(reservation_id,email_type,from_email,to_email,subject,status) values($1,'CANCELLED','test@example.test','test@example.test','Already sent','SENT')",[a.id])
 const result=await service('booking_set_dates',[supplier,tour,['2030-01-07'],false,'CANCELLED','Test cancellation'])
 assert.equal(result.reservationsCancelled,2)
 const again=await service('booking_set_dates',[supplier,tour,['2030-01-07'],false,'CANCELLED','Test cancellation'])
 assert.equal(again.reservationsCancelled,0)
 assert.equal((await db.query("select count(*)::int n from reservations where tour_date_id=$1 and status='CANCELLED'",[d])).rows[0].n,2)
 assert.equal((await db.query("select count(*)::int n from email_logs where reservation_id=any($1::uuid[]) and email_type='CANCELLED'",[[a.id,b.id]])).rows[0].n,2)
 await assert.rejects(create(d),/no longer available/)
})
test('date cancellation rolls back completely when a cancellation notification cannot be queued',async()=>{
 const d=await date('2030-01-08'),r=await create(d)
 await db.exec("create function fail_outbox() returns trigger language plpgsql as $$begin if new.email_type='CANCELLED' then raise exception 'injected cancel outage';end if;return new;end$$;create trigger fail_outbox before insert on email_logs for each row execute function fail_outbox();")
 try {await assert.rejects(service('booking_set_dates',[admin,tour,['2030-01-08'],false,'CANCELLED',null]),/injected cancel/)}finally{await db.exec('drop trigger fail_outbox on email_logs;drop function fail_outbox()')}
 assert.equal((await db.query('select is_open from tour_dates where id=$1',[d])).rows[0].is_open,true)
 assert.equal((await db.query('select status from reservations where id=$1',[r.id])).rows[0].status,'WAITING FOR CONFIRMATION')
})
test('minimum decisions cancel atomically, remain final, and do not recreate stage emails',async()=>{
 const label=(await db.query("select ((now() at time zone 'UTC')::date+3)::text d")).rows[0].d,d=await date(label)
 const r=await create(d)
 const first=await service('booking_sync_minimum',[d]),again=await service('booking_sync_minimum',[d])
 assert.equal(first.created,1);assert.equal(again.created,0)
 assert.equal(first.emailLogsCreated,1);assert.equal(again.emailLogsCreated,0)
 const a=(await db.query('select id from minimum_participant_alerts where tour_date_id=$1',[d])).rows[0]
 await service('booking_resolve_alert',[admin,a.id,'KEEP_TOUR',null])
 await service('booking_resolve_alert',[admin,a.id,'CANCEL_TOUR',null])
 assert.equal((await db.query('select status from reservations where id=$1',[r.id])).rows[0].status,'CANCELLED')
 await assert.rejects(service('booking_resolve_alert',[admin,a.id,'KEEP_TOUR',null]),/already been recorded/)
 assert.equal((await service('booking_sync_minimum',[d])).created,0)
})
test('email claim is exclusive, lease recovers, and attempts beyond idempotency lifetime stop',async()=>{
 const d=await date('2030-01-09'),r=await create(d)
 const log=(await db.query("select id from email_logs where reservation_id=$1 and email_type='NEW_BOOKING'",[r.id])).rows[0]
 await db.query("update email_logs set html_body='<p>test</p>',text_body='test' where id=$1",[log.id])
 const first=await service('booking_claim_email',[log.id,randomUUID()]);assert(first)
 const second=await service('booking_claim_email',[log.id,randomUUID()]);assert.equal(second,undefined)
 await db.query("update email_logs set lease_until=now()-interval '1 minute' where id=$1",[log.id])
 assert(await service('booking_claim_email',[log.id,randomUUID()]))
 await db.query("update email_logs set lease_until=null,first_attempt_at=now()-interval '25 hours' where id=$1",[log.id])
 assert.equal(await service('booking_claim_email',[log.id,randomUUID()]),undefined)
})

test('each new confirmation cycle has its own immutable notification; retries retain the event',async()=>{
 const d=await date('2030-01-10'),r=await create(d)
 await service('booking_transition',[admin,r.id,'CONFIRMED',null])
 await service('booking_transition',[admin,r.id,'NOT CONFIRMED',null])
 await service('booking_transition',[admin,r.id,'CONFIRMED',null])
 await service('booking_transition',[admin,r.id,'CONFIRMED',null])
 const rows=(await db.query("select event_key,reservation_snapshot from email_logs where reservation_id=$1 and email_type='CONFIRMED' order by event_key",[r.id])).rows
 assert.equal(rows.length,2);assert.notEqual(rows[0].event_key,rows[1].event_key)
 assert.equal(rows[0].reservation_snapshot.transition_version,1)
 assert.equal(rows[1].reservation_snapshot.transition_version,3)
})
test('user management preserves history and rejects privilege escalation and self lockout',async()=>{
 await assert.rejects(service('booking_save_user',[agent,admin,{active:false}]),/Permission denied/)
 await assert.rejects(service('booking_save_user',[admin,admin,{active:false}]),/own account/)
 await assert.rejects(service('booking_save_permissions',[admin,admin,[{key:'users_manage_access',enabled:false}]]),/own user-management/)
 await assert.rejects(service('booking_save_permissions',[admin,agent,[{key:'invented_admin',enabled:true}]]),/Invalid permission/)
 const before=(await db.query('select count(*)::int n from reservations')).rows[0].n
 await service('booking_save_user',[admin,agent,{active:false}])
 assert.equal((await db.query('select count(*)::int n from reservations')).rows[0].n,before)
})
test.after(async()=>{await db.close()})
