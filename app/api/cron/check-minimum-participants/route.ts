import { NextResponse } from 'next/server'
import { checkAndCreateAlerts } from '@/app/admin/alerts/actions'

// This endpoint should be called by a cron job daily
// Configure in vercel.json: { "crons": [{ "path": "/api/cron/check-minimum-participants", "schedule": "0 9 * * *" }] }

export async function GET(request: Request) {
  // Verify cron secret in production
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  try {
    const result = await checkAndCreateAlerts()
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `Checked for low participant tours. Created ${result.alertsCreated} alerts.`,
        alertsCreated: result.alertsCreated
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error
      }, { status: 500 })
    }
  } catch (error) {
    console.error('Error in cron job:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 })
  }
}

// Also allow POST for manual triggering
export async function POST(request: Request) {
  return GET(request)
}
