import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { normalizeSupabaseUrl } from '@/lib/supabase/url'

const SUPABASE_URL = normalizeSupabaseUrl(process.env.APP_SUPABASE_URL)
const SUPABASE_ANON_KEY = process.env.JWT_8!

export async function proxy(request: NextRequest) {
  // Build the initial response first. setAll will mutate this reference so
  // that refreshed session tokens are written onto the response that actually
  // reaches the browser.
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  // Refresh the session cookie on every request so it doesn't expire.
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // 1. Mutate the request's cookie jar so downstream Server Components
        //    (layout guards, getCurrentUser) read the refreshed tokens in the
        //    same render pass without a round-trip.
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        // 2. Rebuild the response forwarding the now-mutated request cookies
        //    so the browser receives the updated Set-Cookie headers.
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Single getUser() call — triggers token refresh and returns the auth state.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPost    = request.method === 'POST'
  // RSC prefetch / internal Next.js router requests must never be redirected.
  // When the proxy redirects a prefetch, Next.js Router caches the redirect and
  // sends the user to /login on the very next real navigation — even though their
  // session is perfectly valid. Detect them by their characteristic headers.
  const isPrefetch =
    request.headers.get('Next-Router-Prefetch') === '1' ||
    request.headers.has('Next-Router-State-Tree') ||
    request.nextUrl.searchParams.has('_rsc')

  const isProtected =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/booking') ||
    pathname.startsWith('/availability') ||
    pathname.startsWith('/supplier')
  const isLoginPage = pathname === '/login'

  // Never redirect POSTs (Server Actions) or RSC prefetches.
  if (isProtected && !user && !isPost && !isPrefetch) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // If already logged in, don't show /login — send to /admin/reservations.
  if (isLoginPage && user && !isPrefetch) {
    return NextResponse.redirect(new URL('/admin/reservations', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
