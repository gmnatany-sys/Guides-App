'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function loginAction(formData: FormData) {
  const email = (formData.get('email') as string).trim().toLowerCase()
  const password = formData.get('password') as string
  const next = (formData.get('next') as string | null) || '/admin/reservations'

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    if (error.message.toLowerCase().includes('invalid login')) {
      return { error: 'Invalid email or password.' }
    }
    return { error: error.message }
  }

  // After sign-in, validate the email exists in app_users and is active.
  const { data: appUser } = await supabase
    .from('app_users')
    .select('id, active')
    .ilike('email', email)
    .maybeSingle()

  if (!appUser) {
    await supabase.auth.signOut()
    return { error: 'Your account is not registered in the system. Contact an administrator.' }
  }

  if (!appUser.active) {
    await supabase.auth.signOut()
    return { error: 'Your account has been deactivated. Contact an administrator.' }
  }

  redirect(next)
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
