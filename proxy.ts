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
        // Write tokens onto both request (for downstream Server Components
        // in this same request) and response (for the browser).
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        response = NextResponse.next({
          request: { headers: request.headers },
        })
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

  // Redirect unauthenticated users away from protected routes to /login.
  // Never redirect POST requests: Server Actions arrive as POSTs to the page URL.
  // A 307 on a POST would re-POST to /login instead of executing the action,
  // causing "An unexpected response was received from the server."
  const { pathname } = request.nextUrl
  const isPost = request.method === 'POST'
  const isProtected =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/booking') ||
    pathname.startsWith('/availability') ||
    pathname.startsWith('/supplier')
  const isLoginPage = pathname === '/login'

  if (isProtected && !user && !isPost) {
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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
