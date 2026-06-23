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

  // Always pass through RSC prefetch requests — a redirect stored in the
  // router cache causes spurious redirects on subsequent navigations.
  const isPrefetch =
    request.headers.get('Next-Router-Prefetch') === '1' ||
    request.headers.has('Next-Router-State-Tree') ||
    request.nextUrl.searchParams.has('_rsc')

  if (isPrefetch) {
    return NextResponse.next()
  }

  // Read env vars fresh on every call — never cache as module-level constants.
  const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
  const SUPABASE_ANON_KEY = process.env.JWT_8!

  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // Mutate the request cookie jar so Server Components in the same render
        // pass see the refreshed tokens.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        // Rebuild the response forwarding the mutated request so the browser
        // receives updated Set-Cookie headers.
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Single getUser() call — refreshes the session token if expired.
  const { data: { user } } = await supabase.auth.getUser()

  const isAuthenticated = !!user
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
