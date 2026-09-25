'use client'
import {useEffect,useState} from 'react'
import {fetchGuideChoices} from '@/app/actions/guides'

export function GuidePicker({tourId,value,onChange,disabled=false,allowAll=false}:{tourId?:string;value:string;onChange:(id:string)=>void;disabled?:boolean;allowAll?:boolean}) {
  const [options,setOptions]=useState<{id:string;full_name:string}[]>([])
  const [loadedFor,setLoadedFor]=useState<string|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let ignore=false
    setLoadedFor(null);setError('');setOptions([])
    fetchGuideChoices(tourId).then(result=>{
      if(ignore)return
      setOptions(result.guides);setLoadedFor(tourId ?? '')
      if(!allowAll && !result.guides.some(g=>g.id===value))onChange(result.defaultGuide ?? '')
    }).catch(err=>{if(!ignore){setError(err instanceof Error?err.message:'Unable to load guides');onChange('')}})
    return()=>{ignore=true}
    // The parent clears selection on tour changes; value changes do not refetch options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tourId,allowAll])
  const loading=loadedFor !== (tourId ?? '')
  return <label className="grid gap-2 text-sm font-medium">Guide
    <select aria-label="Guide" name="guide_user_id" value={value} disabled={disabled||loading} onChange={e=>onChange(e.target.value)} className="h-10 rounded-md border bg-white px-3 text-slate-900">
      <option value="">{loading?'Loading guides…':allowAll?'All guides':'Select a guide'}</option>
      {options.map(g=><option key={g.id} value={g.id}>{g.full_name}</option>)}
    </select>
    {error && <span role="alert" className="text-red-700">{error}</span>}
    {!loading&&!options.length&&!error&&<span className="text-muted-foreground">No active guides assigned to this tour.</span>}
  </label>
}
