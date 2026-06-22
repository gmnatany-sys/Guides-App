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
  await supabase.auth.getUser()

  // Redirect unauthenticated users away from protected routes to /login.
  const { pathname } = request.nextUrl
  const isProtected =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/booking') ||
    pathname.startsWith('/availability') ||
    pathname.startsWith('/supplier')
  const isLoginPage = pathname === '/login'

  const {
    data: { user },
  } = await supabase.auth.getUser()

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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
