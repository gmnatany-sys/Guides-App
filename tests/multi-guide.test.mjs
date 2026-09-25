import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
after(()=>db.close())
const file=p=>readFile(new URL('../'+p,import.meta.url),'utf8')
await db.exec(await file('tests/schema-before.sql'))
const admin=randomUUID(),guide=randomUUID(),other=randomUUID(),agent=randomUUID(),tour=randomUUID()
for(const [id,role,name] of [[admin,'admin','Admin'],[guide,'supplier','Guide A'],[agent,'agent','Agent']]){
 await db.query('insert into auth.users values($1,$2)',[id,id+'@example.invalid'])
 await db.query('insert into app_users(id,full_name,email,role) values($1,$2,$3,$4)',[id,name,id+'@example.invalid',role])
}
for(const [id,keys] of [[admin,['tours_manage_access','users_manage_access','booking_form_access','reservations_action_access','availability_calendar_manage_access','minimum_participants_action_access']],[guide,['supplier_confirmation_action','minimum_participants_action_access']],[agent,['booking_form_access']]])for(const key of keys)await db.query('insert into user_permissions(user_id,permission_key,enabled) values($1,$2,true)',[id,key])
await db.query('insert into tours(id,name) values($1,$2)',[tour,'Shared Tour'])
await db.exec(await file('database/prepare-remediation.sql'))
await db.exec(await file('database/lockdown-remediation.sql'))
const legacy=randomUUID()
await db.query("insert into tour_dates(id,tour_id,tour_date,is_open,supplier_status) values($1,$2,'2030-01-01',true,'YES')",[legacy,tour])
const before=(await db.query('select to_jsonb(t) data from tour_dates t')).rows[0].data
await db.exec(await file('database/multi-guide.sql'))
await db.query("insert into app_users(id,full_name,email,role) values($1,'Guide B',$2,'supplier')",[other,other+'@example.invalid'])
for(const key of ['supplier_confirmation_action','minimum_participants_action_access','users_manage_access'])await db.query('insert into user_permissions(user_id,permission_key,enabled) values($1,$2,true)',[other,key])
await db.query('insert into guide_tours(guide_user_id,tour_id) values($1,$2)',[other,tour])
const rpc=async(name,args)=>{
 await db.exec('set role service_role')
 try{return (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result}
 finally{await db.exec('reset role')}
}
const open=(who,day)=>rpc('booking_set_guide_dates',[who,tour,who,[day],true,'YES',null])
const create=(date,pax=2)=>rpc('booking_create',[agent,{tour_id:tour,tour_date_id:date,reservation_number:'TEST',voucher_number:randomUUID(),lead_passenger_name:'Synthetic',whatsapp_number:'+10000000000',participants:pax,agent_user_id:agent}])
test('migration preserves legacy ids and original values while linking the only existing guide',async()=>{
 const row=(await db.query('select to_jsonb(t) data from tour_dates t where id=$1',[legacy])).rows[0].data
 for(const key of Object.keys(before))assert.deepEqual(row[key],before[key])
 assert.equal(row.guide_user_id,guide);assert.equal(row.capacity,8)
})
test('same tour and day have independent guide inventory, routing and cancellation',async()=>{
 const a=(await open(guide,'2030-02-01')).dateIds[0],b=(await open(other,'2030-02-01')).dateIds[0]
 assert.notEqual(a,b)
 const ra=await create(a,8),rb=await create(b,8)
 await assert.rejects(create(a,1),/Not enough seats/)
 await assert.rejects(rpc('booking_transition',[other,ra.id,'CONFIRMED',null]),/another guide/)
 await assert.rejects(rpc('booking_set_guide_dates',[other,tour,guide,['2030-02-01'],false,'CANCELLED',null]),/outside your access/)
 await rpc('booking_transition',[guide,ra.id,'CONFIRMED',null])
 await rpc('booking_set_guide_dates',[guide,tour,guide,['2030-02-01'],false,'CANCELLED',null])
 assert.equal((await db.query('select status from reservations where id=$1',[rb.id])).rows[0].status,'WAITING FOR CONFIRMATION')
 const emails=(await db.query("select reservation_id,to_email,cc from email_logs where email_type='NEW_BOOKING'")).rows
 assert.equal(emails.find(e=>e.reservation_id===ra.id).to_email,guide+'@example.invalid')
 assert.equal(emails.find(e=>e.reservation_id===rb.id).to_email,other+'@example.invalid')
 assert(!JSON.stringify(emails).includes('itai@'))
})
test('catalog edits do not change capacity of existing departures',async()=>{
 const input={name:'Shared Tour',description:'Test',max_capacity:12,min_participants:6,active:true,default_guide_user_id:guide}
 await rpc('booking_save_tour',[admin,tour,input,[guide,other]])
 assert.equal((await db.query('select capacity from tour_dates where id=$1',[legacy])).rows[0].capacity,8)
 const id=(await open(other,'2030-03-01')).dateIds[0]
 const date=(await db.query('select capacity,minimum_participants from tour_dates where id=$1',[id])).rows[0]
 assert.deepEqual(date,{capacity:12,minimum_participants:6})
 await assert.rejects(rpc('booking_save_tour',[admin,tour,input,[guide]]),/future departures/)
})
test('supplier cannot escalate through a mistakenly granted management permission',async()=>{
 await assert.rejects(rpc('booking_save_user',[other,other,{role:'admin'}]),/Permission denied/)
})
test('new tables and all booking functions remain backend only',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role)
  try{await assert.rejects(db.query('select * from guide_tours'),/permission denied/);await assert.rejects(db.query('select booking_guide_email($1)',[legacy]),/permission denied/)}finally{await db.exec('reset role')}
 }
 assert.deepEqual((await db.query(await file('database/verify-remediation.sql'))).rows,[])
 assert.deepEqual((await db.query(await file('database/verify-multi-guide.sql'))).rows,[])
})

test('minimum alerts and recipients remain separate for two guides on the same day',async()=>{
 const day=(await db.query("select ((now() at time zone 'UTC')::date+5)::text as departure_day")).rows[0].departure_day
 const ids=[(await open(guide,day)).dateIds[0],(await open(other,day)).dateIds[0]]
 for(const id of ids)await create(id,2)
 await rpc('booking_check_guide_minimum',[guide])
 assert.equal((await db.query('select count(*)::int n from minimum_participant_alerts where tour_date_id=$1',[ids[1]])).rows[0].n,0)
 await rpc('booking_check_guide_minimum',[other])
 const rows=(await db.query("select * from email_logs where email_type='LOW_PARTICIPANTS_5_DAYS'")).rows
 assert.equal(rows.length,4)
 assert(rows.some(r=>r.to_email==='gmnatany@yapantours.com'&&r.cc.includes(other+'@example.invalid')))
 assert(rows.some(r=>r.to_email==='gmnatany@yapantours.com'&&r.cc.includes(guide+'@example.invalid')))
 await rpc('booking_check_guide_minimum',[other])
 assert.equal((await db.query("select count(*)::int n from email_logs where email_type='LOW_PARTICIPANTS_5_DAYS'")).rows[0].n,4)
 const alert=(await db.query('select id,minimum_required from minimum_participant_alerts where tour_date_id=$1',[ids[0]])).rows[0]
 assert.equal(alert.minimum_required,6)
 await assert.rejects(rpc('booking_resolve_alert',[other,alert.id,'CANCEL_TOUR',null]),/another guide/)
 await rpc('booking_resolve_alert',[guide,alert.id,'KEEP_TOUR',null])
 assert.equal((await db.query('select status from minimum_participant_alerts where tour_date_id=$1',[ids[1]])).rows[0].status,'OPEN')
})

test('counts are scoped and staff can still see all reservations',async()=>{
 for(const id of [guide,other,admin])await db.query("insert into user_permissions(user_id,permission_key,enabled) values($1,'supplier_confirmation_view',true) on conflict(user_id,permission_key) do update set enabled=true",[id])
 for(const id of [guide,other]){
  const expected=(await db.query('select count(*)::int n from reservations r join tour_dates d on d.id=r.tour_date_id where d.guide_user_id=$1',[id])).rows[0].n
  assert.equal(Object.values(await rpc('booking_supplier_counts',[id])).reduce((a,b)=>a+b,0),expected)
 }
 const total=(await db.query('select count(*)::int n from reservations')).rows[0].n
 assert.equal(Object.values(await rpc('booking_supplier_counts',[admin])).reduce((a,b)=>a+b,0),total)
})

test('new guide receives only guide permissions and cannot be deactivated with future work',async()=>{
 const fresh=await rpc('booking_save_user',[admin,null,{full_name:'New Guide',email:randomUUID()+'@example.invalid',role:'supplier',active:true}])
 const permissions=(await db.query('select permission_key from user_permissions where user_id=$1 and enabled',[fresh.id])).rows.map(r=>r.permission_key)
 assert.equal(permissions.length,5);assert(permissions.includes('supplier_confirmation_action'));assert(!permissions.includes('users_manage_access'))
 await assert.rejects(rpc('booking_save_user',[admin,guide,{active:false}]),/future departures/)
 await assert.rejects(rpc('booking_save_user',[admin,guide,{role:'agent'}]),/departure history/)
})

test('stale guide selection and unassigned guide opening fail without partial writes',async()=>{
 const id=(await open(guide,'2030-04-01')).dateIds[0]
 await assert.rejects(rpc('booking_create',[agent,{tour_id:tour,tour_date_id:id,guide_user_id:other,participants:1,agent_user_id:agent,reservation_number:'TEST',voucher_number:randomUUID(),lead_passenger_name:'Test',whatsapp_number:'+10000000000'}]),/Selected guide/)
 assert.equal((await db.query('select count(*)::int n from reservations where tour_date_id=$1',[id])).rows[0].n,0)
 const otherTour=await rpc('booking_save_tour',[admin,null,{name:'Exclusive',active:true,min_participants:4,max_capacity:8,default_guide_user_id:guide},[guide]])
 await assert.rejects(rpc('booking_set_guide_dates',[other,otherTour.id,other,['2030-04-02'],true,'YES',null]),/not active or assigned/)
})

test('closing and cancelling remain possible after a tour is made inactive',async()=>{
 const day='2030-04-03',id=(await open(guide,day)).dateIds[0]
 const reservation=await create(id)
 await rpc('booking_save_tour',[admin,tour,{name:'Shared Tour',active:false,min_participants:6,max_capacity:12,default_guide_user_id:guide},[guide,other]])
 await rpc('booking_set_guide_dates',[guide,tour,guide,[day],false,'CANCELLED',null])
 assert.equal((await db.query('select status from reservations where id=$1',[reservation.id])).rows[0].status,'CANCELLED')
 await assert.rejects(open(guide,'2030-04-04'),/not active or assigned/)
})
