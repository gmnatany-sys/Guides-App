import { logoutAction } from '@/app/login/actions'

export default function NoAccessPage() {
  return <main className="mx-auto max-w-lg p-12">
    <h1 className="text-xl font-semibold">Account access</h1>
    <p className="my-4">Your account has no available pages. Contact an administrator to enable access.</p>
    <form action={logoutAction}><button type="submit" className="underline">Sign out</button></form>
  </main>
}
