import { LoginForm } from './login-form'

// Server Component — extracts the ?next= param and passes it to the LoginForm.
// If the user is already authenticated, the proxy redirects them away from /login
// before this page ever renders, so no session check is needed here.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  // Pass next through to the form — loginAction decides whether to honour it
  // based on the user's role. Empty string means loginAction picks the role home.
  const destination = next && next.startsWith('/') && next !== '/login' ? next : ''
  return <LoginForm next={destination} />
}
