import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

async function load(relative, mocks={}, cache=new Map()) {
  if(cache.has(relative))return cache.get(relative)
  const text=await readFile(new URL('../'+relative,import.meta.url),'utf8')
  const code=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  const module=new vm.SourceTextModule(code,{identifier:relative});cache.set(relative,module)
  await module.link(async specifier=>{
    if(specifier in mocks) {
      const values=mocks[specifier]
      return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value)})
    }
    if(specifier==='server-only')return new vm.SyntheticModule([],()=>{})
    if(specifier.startsWith('@/'))return load(specifier.slice(2)+'.ts',mocks,cache)
    const values=await import(specifier)
    return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value)})
  })
  await module.evaluate();return module
}

test('every protected public server action rejects an unauthenticated call before database access',async()=>{
  let databaseCalls=0
  const mocks={
    '@/lib/auth':{getCurrentUser:async()=>null},
    '@/lib/supabase-admin':{getServiceRoleClient:()=>{databaseCalls++;throw new Error('UNAUTHORIZED DATABASE ACCESS')},findAuthUserByEmail:async()=>{databaseCalls++;throw new Error('UNAUTHORIZED AUTH ACCESS')}},
    'next/cache':{revalidatePath:()=>{}},'next/server':{after:()=>{}},
    '@/lib/email-log':{deliverReservationEmails:async()=>({}),processEmailOutbox:async()=>({}),createEmailLog:async()=>({})},
  }
  const paths=(await readdir(new URL('../app/',import.meta.url),{recursive:true})).filter(p=>p.endsWith('actions.ts')&&!p.includes('login')).map(p=>'app/'+p.replaceAll('\\','/'))
  let checked=0
  for(const path of paths) {
    const module=await load(path,mocks)
    const source=ts.createSourceFile(path,await readFile(new URL('../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
    for(const declaration of source.statements)if(ts.isFunctionDeclaration(declaration)&&declaration.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)) {
      const name=declaration.name.text
      const args=declaration.parameters.map(param=>param.type?.getText(source)==='FormData'?new FormData():param.type?.getText(source).includes('[]')?[]:'00000000-0000-0000-0000-000000000001')
      await assert.rejects(module.namespace[name](...args),/permission/i,path+':'+name)
      checked++
    }
  }
  assert(checked>=40);assert.equal(databaseCalls,0)
})

test('permission gates reject inactive users and respect individual keys without an admin bypass',async()=>{
  let actor={id:'a',active:true,role:'admin',permissions:['booking_form_access']}
  const module=await load('lib/authorization.ts',{'@/lib/auth':{getCurrentUser:async()=>actor}})
  assert.equal((await module.namespace.requirePermission('booking_form_access')).id,'a')
  await assert.rejects(module.namespace.requirePermission('users_manage_access'),/permission/)
  actor.active=false
  await assert.rejects(module.namespace.requirePermission('booking_form_access'),/permission/)
})

test('email HTML escapes passenger fields and preserves plain text and cancellation reason',async()=>{
  const module=await load('lib/email-log.ts',{'@/lib/supabase-admin':{getServiceRoleClient:()=>{throw new Error('No network in tests')}}})
  const body=module.namespace.renderEmail('Test <subject>',{lead_passenger_name:'<img src=x onerror=alert(1)>',internal_notes:'Minimum not reached & cancelled',tours:{name:'Test Tour'}})
  assert(!body.html.includes('<img src=x'))
  assert(body.html.includes('&lt;img'))
  assert(body.html.includes('Minimum not reached &amp; cancelled'))
  assert(body.text.includes('<img src=x onerror=alert(1)>'))
})

test('dry-run delivery never calls the email provider',async()=>{
  let providerCalls=0
  const query={in(){return this},not(){return this},or(){return this},order(){return this},limit(){return this},then(resolve){resolve({data:[{id:'test'}],error:null})}}
  const module=await load('lib/email-log.ts',{
    '@/lib/supabase-admin':{getServiceRoleClient:()=>({from:()=>({select:()=>query})})},
    resend:{Resend:class{constructor(){providerCalls++;throw new Error('Forbidden real send')}}},
  })
  const result=await module.namespace.processEmailOutbox({dryRun:true})
  assert.equal(result.sent,0);assert.equal(result.pending,1);assert.equal(providerCalls,0)
})

test('cron rejects missing and incorrect secrets before any database call',async()=>{
  let calls=0
  const previous=process.env.CRON_SECRET
  const module=await load('app/api/cron/check-minimum-participants/route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status ?? 200})}},
    '@/lib/minimum-participants':{checkAndCreateAlerts:async()=>{calls++;return {success:true}}},
    '@/lib/email-log':{processEmailOutbox:async()=>{calls++;return {success:true}}},
  })
  try {
    delete process.env.CRON_SECRET
    assert.equal((await module.namespace.GET(new Request('http://localhost/cron'))).status,503)
    process.env.CRON_SECRET='synthetic-test-secret'
    assert.equal((await module.namespace.GET(new Request('http://localhost/cron',{headers:{authorization:'Bearer wrong'}}))).status,401)
    assert.equal(calls,0)
    assert.equal((await module.namespace.GET(new Request('http://localhost/cron',{headers:{authorization:'Bearer synthetic-test-secret'}}))).status,200)
    assert.equal(calls,2)
  } finally { if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous }
})

test('provider acceptance followed by a receipt failure retries with the same frozen payload and key',async()=>{
 const previous=process.env.RESEND_API_KEY
 const row={id:'test',status:'PENDING',event_key:'reservation/test/CONFIRMED/1',subject:'Saved subject',html_body:'<p>Frozen</p>',text_body:'Frozen',from_email:'test@example.test',to_email:'recipient@example.test',cc:null,lease_token:null}
 let locked=false,failReceipt=true
 const calls=[]
 const service={
  from(){let changes=null;return {
   select(){return this},eq(){return this},is(){return this},neq(){return this},update(value){changes=value;return this},
   async single(){
    if(changes && failReceipt){failReceipt=false;return {data:null,error:{message:'Injected receipt outage'}}}
    if(changes)Object.assign(row,changes)
    return {data:{...row},error:null}
   },
  }},
  async rpc(name,{p_token}){
   assert.equal(name,'booking_claim_email')
   if(locked)return {data:[],error:null}
   locked=true;row.lease_token=p_token
   return {data:[{...row}],error:null}
  },
 }
 const module=await load('lib/email-log.ts',{
  '@/lib/supabase-admin':{getServiceRoleClient:()=>service},
  resend:{Resend:class{emails={send:async(payload,options)=>{calls.push({payload,options});return {data:{id:'provider-test'},error:null}}}}},
 })
 try {
  process.env.RESEND_API_KEY='synthetic-no-network'
  const first=await module.namespace.sendEmailLog('test')
  assert.equal(first.success,false);assert.match(first.error,/saving the receipt failed/)
  assert.equal((await module.namespace.sendEmailLog('test')).success,false)
  assert.equal(calls.length,1)
  locked=false
  assert.equal((await module.namespace.sendEmailLog('test')).success,true)
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].options.idempotencyKey,row.event_key)
  assert.equal(row.status,'SENT')
  assert.equal((await module.namespace.sendEmailLog('test')).skipped,true)
  assert.equal(calls.length,2)
 }finally{if(previous===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=previous}
})
