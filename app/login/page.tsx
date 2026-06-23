import { LoginForm } from './login-form'

// Server component — reads searchParams to extract the ?next= redirect target
// and passes it down to the client LoginForm as a prop (and hidden field).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const destination = next && next.startsWith('/') ? next : '/admin/reservations'
  return <LoginForm next={destination} />
}
