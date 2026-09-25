'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {Button} from '@/components/ui/button'
import {fetchTourManagement,saveTour} from './actions'

type Catalog=Awaited<ReturnType<typeof fetchTourManagement>>
type Tour=Catalog['tours'][number]
const field='grid gap-2 text-sm font-medium'
const input='rounded-md border bg-white p-2 text-slate-900'
export default function TourManager(){
  const [data,setData]=useState<Catalog|null>(null)
  const [editing,setEditing]=useState<Tour|null|undefined>(undefined)
  const [selected,setSelected]=useState<string[]>([])
  const [defaultGuide,setDefaultGuide]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  async function load(){setData(await fetchTourManagement())}
  useEffect(()=>{load().catch(e=>setMessage(e.message))},[])
  function edit(tour:Tour|null){
    setEditing(tour);setMessage('')
    setSelected(tour?data!.assignments.filter(a=>a.tour_id===tour.id).map(a=>a.guide_user_id):[])
    setDefaultGuide(tour?.default_guide_user_id??'')
  }
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setMessage('')
    try{const result=await saveTour(editing?.id??null,form);if(!result.success)throw new Error(result.error);await load();setEditing(undefined);setMessage('Tour saved. Existing departure capacities are unchanged.')}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to save tour.')}
    finally{setBusy(false)}
  }
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Tours</h1><p className="text-muted-foreground">Create tours and assign the guides who can open departures.</p></div><Button onClick={()=>edit(null)} disabled={!data||busy}>Add Tour</Button></div>
    {message&&<p role="status" className="rounded border p-3">{message}</p>}
    {!data&&<p>Loading tours…</p>}
    {data&&editing!==undefined&&<form key={editing?.id??'new'} onSubmit={submit} className="space-y-4 rounded-lg border bg-white p-5">
      <h2 className="text-lg font-semibold">{editing?'Edit Tour':'New Tour'}</h2>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label className={field}>Tour name<input className={input} name="name" required maxLength={200} defaultValue={editing?.name??''}/></label>
        <label className={field}>Description<input className={input} name="description" maxLength={2000} defaultValue={editing?.description??''}/></label>
        <label className={field}>Default capacity<input className={input} type="number" min={1} step={1} name="max_capacity" required defaultValue={editing?.max_capacity??8}/></label>
        <label className={field}>Minimum participants<input className={input} type="number" min={1} step={1} name="min_participants" required defaultValue={editing?.min_participants??4}/></label>
        <div className="space-y-2"><p className="text-sm font-medium">Assigned guides</p>{data.guides.filter(g=>g.active||selected.includes(g.id)).map(g=><label key={g.id} className="flex items-center gap-2"><input type="checkbox" name="guide_ids" value={g.id} checked={selected.includes(g.id)} onChange={e=>{const next=e.target.checked?[...selected,g.id]:selected.filter(id=>id!==g.id);setSelected(next);if(!next.includes(defaultGuide))setDefaultGuide(next[0]??'')}}/>{g.full_name}{!g.active?' (inactive)':''}</label>)}{!data.guides.length&&<Link className="underline" href="/admin/guides">Add a guide first</Link>}</div>
        <label className={field}>Default guide<select className={input} name="default_guide_user_id" required value={defaultGuide} onChange={e=>setDefaultGuide(e.target.value)}><option value="">Select a guide</option>{data.guides.filter(g=>selected.includes(g.id)).map(g=><option key={g.id} value={g.id}>{g.full_name}</option>)}</select></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={editing?.active??true}/>Active tour</label>
      </fieldset>
      <p className="text-sm text-muted-foreground">Capacity and minimum changes apply to new departures. Existing bookings and departures keep their settings.</p>
      <div className="flex gap-2"><Button type="submit" disabled={busy||!selected.length}>{busy?'Saving…':'Save Tour'}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setEditing(undefined)}>Cancel</Button></div>
    </form>}
    {data&&<div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50">{['Tour','Guides','Capacity / minimum','Status',''].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.tours.map(t=><tr key={t.id} className="border-b"><td className="p-3 font-medium">{t.name}</td><td className="p-3">{data.assignments.filter(a=>a.tour_id===t.id).map(a=>data.guides.find(g=>g.id===a.guide_user_id)?.full_name??'Unknown guide').join(', ')}</td><td className="p-3">{t.max_capacity} / {t.min_participants}</td><td className="p-3">{t.active?'Active':'Inactive'}</td><td className="p-3"><Button variant="outline" onClick={()=>edit(t)} disabled={busy}>Edit</Button></td></tr>)}</tbody></table></div>}
  </div>
}
