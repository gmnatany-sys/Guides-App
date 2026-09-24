import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { checkAndCreateAlerts } from '@/lib/minimum-participants'
import { processEmailOutbox } from '@/lib/email-log'

export const maxDuration = 60
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({success:false,error:'Cron is not configured.'},{status:503})
  const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(request.headers.get('authorization') ?? '')
  if(expected.length!==actual.length || !timingSafeEqual(expected,actual)) return NextResponse.json({success:false,error:'Unauthorized'},{status:401})
  try {
    const result=await checkAndCreateAlerts()
    if(!result.success) return NextResponse.json(result,{status:500})
    const delivery=await processEmailOutbox({limit:20})
    return NextResponse.json({...result,delivery,success:delivery.success},{status:delivery.success?200:500})
  } catch {
    return NextResponse.json({success:false,error:'Scheduled processing failed.'},{status:500})
  }
}
export async function POST(request: Request) { return GET(request) }
