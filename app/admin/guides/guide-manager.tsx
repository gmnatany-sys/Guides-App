'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {Button} from '@/components/ui/button'
import {createGuide,fetchGuideManagement} from './actions'
type Data=Awaited<ReturnType<typeof fetchGuideManagement>>
export default function GuideManager(){
  const [data,setData]=useState<Data|null>(null),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const load=async()=>setData(await fetchGuideManagement())
  useEffect(()=>{load().catch(e=>setMessage(e.message))},[])
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setMessage('')
    try{const result=await createGuide(form);if(!result.success)throw new Error(result.error);await load();setAdding(false);setMessage('Guide profile created. Set up sign-in in Users, then assign tours in Tours.')}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to create guide.')}
    finally{setBusy(false)}
  }
  return <div className="space-y-6"><div className="flex justify-between gap-4"><div><h1 className="text-2xl font-semibold">Guides</h1><p className="text-muted-foreground">Each guide manages their own departures and reservations.</p></div><Button onClick={()=>setAdding(true)} disabled={busy}>Add Guide</Button></div>
    {message&&<p role="status" className="rounded border p-3">{message}</p>}
    {adding&&<form onSubmit={submit} className="space-y-4 rounded-lg border bg-white p-5"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2">Full name<input name="full_name" required maxLength={200} className="rounded border p-2"/></label><label className="grid gap-2">Email<input name="email" type="email" required className="rounded border p-2"/></label></fieldset><p className="text-sm text-muted-foreground">This email receives booking notifications. A new profile needs sign-in setup in Users before the guide can log in.</p><div className="flex gap-2"><Button disabled={busy}>{busy?'Saving…':'Create Guide'}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setAdding(false)}>Cancel</Button></div></form>}
    <div className="flex gap-4 text-sm"><Link className="text-blue-700 underline" href="/admin/users">Manage sign-in and permissions</Link><Link className="text-blue-700 underline" href="/admin/tours">Assign tours</Link></div>
    {!data?<p>Loading guides…</p>:<div className="grid gap-4 md:grid-cols-2">{data.guides.map(g=><article key={g.id} className="space-y-2 rounded-lg border bg-white p-5"><h2 className="text-lg font-semibold">{g.full_name}</h2><p>{g.email}</p><p className="text-sm">{g.active?'Active':'Inactive'} · {g.loginReady?'Sign-in configured':'Sign-in setup required'}</p><p className="text-sm text-muted-foreground">Tours: {data.assignments.filter(a=>a.guide_user_id===g.id).map(a=>{const t=Array.isArray(a.tours)?a.tours[0]:a.tours;return t?.name}).join(', ')||'No tours assigned'}</p></article>)}</div>}
  </div>
}
