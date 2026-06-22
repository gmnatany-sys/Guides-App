import { type NextRequest, NextResponse } from 'next/server'

// AUTH_ENFORCEMENT_ENABLED = false
// All auth redirects and session refresh logic are bypassed.
// Re-enable by restoring the full proxy implementation.
export async function proxy(request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
