'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Role → default landing page after login.
// The `next` param (from ?next=) overrides this only for admin/operation roles
// so that deep links work (e.g. clicking a link that sends you to /admin/users
// while logged out will bring you there after login, not to /admin/reservations).
// Agent and supplier roles always land on their fixed home page regardless of
// the `next` param — deep links into admin routes should not be honoured for them.
const ROLE_HOME: Record<string, string> = {
  admin:     '/admin/reservations',
  operation: '/admin/reservations',
  agent:     '/booking',
  supplier:  '/supplier/confirm',
  guide:     '/supplier/confirm',
}

export async function loginAction(formData: FormData) {
  const email    = (formData.get('email') as string).trim().toLowerCase()
  const password = formData.get('password') as string
  const next     = (formData.get('next') as string | null) || ''

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  const supabase = await createClient()

  // 1. Authenticate against Supabase Auth.
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

  if (authError) {
    if (
      authError.message.toLowerCase().includes('invalid login') ||
      authError.message.toLowerCase().includes('invalid credentials') ||
      authError.message.toLowerCase().includes('email not confirmed')
    ) {
      return { error: 'Invalid email or password.' }
    }
    return { error: `Authentication error: ${authError.message}` }
  }

  // Force the Supabase SSR cookie write to happen synchronously before redirect().
  //
  // Root cause of the original session-loss bug:
  // signInWithPassword() stores the session in memory and then emits a SIGNED_IN
  // event via onAuthStateChange — but that listener is registered as async and
  // fires AFTER signInWithPassword() returns. When redirect() is called next, it
  // throws a NEXT_REDIRECT error that unwinds the stack immediately, so the async
  // onAuthStateChange callback (which calls setAll → cookieStore.set()) never runs.
  // Result: no Set-Cookie header is ever sent to the browser.
  //
  // Fix: calling getSession() forces a synchronous read of the in-memory session,
  // which triggers applyServerStorage → setAll → cookieStore.set() immediately,
  // writing sb-handniwiwphefterousk-auth-token to the cookie store before redirect()
  // throws. The browser then receives the Set-Cookie header and subsequent requests
  // carry the auth cookie, which the proxy reads to confirm the session.
  await supabase.auth.getSession()

  // 2. Verify the email exists in app_users and is active.
  const { data: appUser, error: userError } = await supabase
    .from('app_users')
    .select('id, role, active')
    .ilike('email', email)
    .maybeSingle()

  if (userError) {
    await supabase.auth.signOut()
    return { error: 'Session error — could not verify your account. Please try again.' }
  }

  if (!appUser) {
    await supabase.auth.signOut()
    return { error: 'Your account is not registered in the system. Contact an administrator.' }
  }

  if (!appUser.active) {
    await supabase.auth.signOut()
    return { error: 'Your account has been deactivated. Contact an administrator.' }
  }

  // 3. Determine destination.
  // For admin/operation: honour the ?next= param so deep links work.
  // For agent/supplier/guide: always go to their fixed home, ignore ?next=.
  const role = appUser.role as string
  const roleHome = ROLE_HOME[role] ?? '/admin/reservations'

  let destination: string
  if ((role === 'admin' || role === 'operation') && next && next.startsWith('/') && next !== '/login') {
    destination = next
  } else {
    destination = roleHome
  }

  redirect(destination)
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
