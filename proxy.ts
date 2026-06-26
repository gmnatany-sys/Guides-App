import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { normalizeSupabaseUrl } from '@/lib/supabase/url'

const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
const SUPABASE_ANON_KEY = process.env.JWT_8!

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Reject malformed paths that contain a comma — no valid app route has one.
  // These are stale browser requests or bot probes with joined URLs
  // (e.g. /admin/tours,%20/admin/tours). Returning 404 immediately avoids
  // firing a Supabase Auth round-trip for invalid input.
  if (pathname.includes(',')) {
    return new NextResponse(null, { status: 404 })
  }

  let response = NextResponse.next({ request })

  // Refresh the session cookie on every request so it doesn't expire.
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          request.cookies.set(name, value)
        )
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Use getSession() here — it decodes the JWT locally (no network round-trip)
  // and is sufficient to decide whether a user is logged in for the redirect
  // gate below. getUser() (which makes a remote Supabase Auth call to verify
  // the JWT) is reserved for getCurrentUser() in lib/auth.ts where full trust
  // is required. This reduces proxy latency from ~1000ms to ~1ms.
  const t0 = Date.now()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  console.log(`[v0] proxy getSession: ${Date.now() - t0}ms — ${pathname}`)

  const isLoggedIn = !!session?.user
  const isProtected =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/booking') ||
    pathname.startsWith('/availability') ||
    pathname.startsWith('/supplier')
  const isLoginPage = pathname === '/login'

  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // If already logged in, don't show /login.
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  // Only run on real app routes that need auth protection or session refresh.
  // Explicitly excludes:
  //   - _next/static  (JS/CSS chunks, webpack bundles)
  //   - _next/image   (image optimisation)
  //   - _next/data    (RSC payload fetches – already protected at page level)
  //   - /api          (API routes handle their own auth)
  //   - favicon.ico, robots.txt, sitemap.xml
  //   - any static file extension (images, fonts, audio, video, wasm, json, xml, txt)
  matcher: [
    '/login',
    '/admin/:path*',
    '/booking/:path*',
    '/availability/:path*',
    '/supplier/:path*',
  ],
}
