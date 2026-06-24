import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { normalizeSupabaseUrl } from '@/lib/supabase/url'

const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
const SUPABASE_ANON_KEY = process.env.JWT_8!

export async function proxy(request: NextRequest) {
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

  // Calling getUser() triggers the token refresh if needed.
  // Store the result to avoid a second round-trip below.
  const t0 = Date.now()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  console.log(`[v0] proxy getUser: ${Date.now() - t0}ms — ${request.nextUrl.pathname}`)

  // Redirect unauthenticated users away from protected routes to /login.
  const { pathname } = request.nextUrl
  const isProtected =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/booking') ||
    pathname.startsWith('/availability') ||
    pathname.startsWith('/supplier')
  const isLoginPage = pathname === '/login'

  if (isProtected && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // If already logged in, don't show /login.
  if (isLoginPage && user) {
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
