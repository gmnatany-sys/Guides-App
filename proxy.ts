import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { normalizeSupabaseUrl } from '@/lib/supabase/url'

/**
 * Stage 1 — session refresh + login protection.
 *
 * Responsibilities:
 * 1. Refresh the Supabase session token on every full-page navigation so the
 *    access token never silently expires mid-session.
 * 2. Redirect unauthenticated requests for protected routes to /login?next=<path>.
 * 3. Redirect already-authenticated users away from /login to avoid a loop.
 *
 * Safety rules that prevent the redirect loops from the previous build:
 * - Env vars read per-call, never cached as module-level constants (they go
 *   undefined during Next.js dev-server env reloads).
 * - POSTs (Server Actions) are always passed through — redirecting a POST breaks
 *   Server Actions entirely.
 * - RSC prefetch requests are always passed through — a redirect cached by the
 *   router causes spurious /login redirects on the next real navigation.
 * - /login itself is never redirected, preventing an infinite loop.
 * - No permission queries, no app_users queries — only auth.getUser().
 */

// Routes that do NOT require a login session.
const PUBLIC_PATHS = ['/login']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always pass through POSTs (Server Actions) — never redirect them.
  if (request.method === 'POST') {
    return NextResponse.next()
  }

  // RSC prefetch/navigation requests MUST go through the full auth check.
  //
  // Previous bug: the proxy returned NextResponse.next() for all requests
  // carrying Next-Router-Prefetch or Next-Router-State-Tree headers, bypassing
  // auth entirely. For an unauthenticated user, the RSC payload for a protected
  // page (e.g. /admin/users) would be fetched without a session and Next.js
  // would render the login page as the RSC response. That response got stored
  // in the router cache. When the user then clicked the sidebar link, the router
  // served the cached login-page payload instead of making a fresh request,
  // making it appear as if every navigation redirected to /login.
  //
  // Correct behaviour: the auth check runs on ALL request types. For prefetches
  // of protected pages when the user IS authenticated, NextResponse.next() is
  // returned normally and the RSC payload for the real page is cached. For
  // prefetches when the user is NOT authenticated, a redirect is returned so
  // the router caches the redirect (not the login page content) and handles it
  // correctly when the link is actually clicked.

  // Read env vars fresh on every call — never cache as module-level constants.
  const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
  const SUPABASE_ANON_KEY = process.env.JWT_8!

  // Create the pass-through response ONCE and never rebuild it.
  // Rebuilding (NextResponse.next({ request })) inside setAll was the bug:
  // it created a brand-new response object that discarded any cookies already
  // written to the previous response, losing the session on every navigation.
  const response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // Write refreshed tokens onto BOTH the request (so Server Components in
        // this render see them) AND the fixed response object (so the browser
        // receives Set-Cookie headers).  Never reassign `response` here.
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  // getUser() triggers the session refresh and fires onAuthStateChange →
  // applyServerStorage → setAll above if the token was rotated.
  const { data: { user }, error: getUserError } = await supabase.auth.getUser()

  const isAuthenticated = !!user && !getUserError
  const isPublic = isPublicPath(pathname)

  // Unauthenticated request to a protected route → redirect to /login?next=<path>
  if (!isAuthenticated && !isPublic) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = `next=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated user visiting /login → redirect to default home to avoid loop.
  if (isAuthenticated && pathname === '/login') {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/admin/reservations'
    homeUrl.search = ''
    return NextResponse.redirect(homeUrl)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
