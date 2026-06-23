import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { normalizeSupabaseUrl } from '@/lib/supabase/url'

/**
 * Stage 1 — session refresh only, no auth redirects.
 *
 * The proxy's only job is to call getUser() so Supabase can rotate the
 * access token before it expires and write the updated cookie onto the response.
 * It never redirects to /login. All pages remain fully accessible.
 *
 * Bugs avoided from previous implementation:
 * - Env vars read inside the function body, never as module-level constants
 *   (module-level constants go undefined during Next.js dev env reloads).
 * - Single getUser() call only — no double-call pattern.
 * - POST requests (Server Actions) skipped — a redirect on a POST breaks actions.
 * - RSC prefetch requests skipped — a redirect on a prefetch gets cached by the
 *   router and causes spurious /login redirects on the next real navigation.
 */
export async function proxy(request: NextRequest) {
  // Skip POSTs (Server Actions) and RSC prefetches.
  const isPost = request.method === 'POST'
  const isPrefetch =
    request.headers.get('Next-Router-Prefetch') === '1' ||
    request.headers.has('Next-Router-State-Tree') ||
    request.nextUrl.searchParams.has('_rsc')

  if (isPost || isPrefetch) {
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
        // 1. Mutate the request cookie jar so downstream Server Components
        //    in the same render pass see the refreshed tokens.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        // 2. Rebuild the response forwarding the now-mutated request so the
        //    browser receives the updated Set-Cookie headers.
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Refresh the session token if it has expired.
  // The result is unused in Stage 1 — no auth enforcement here.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
