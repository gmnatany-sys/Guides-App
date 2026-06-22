// Lightweight skeleton shown via Next.js loading.tsx boundaries while a route
// segment is rendering. It gives instant visual feedback on navigation so the
// app no longer feels like it "hangs" after a sidebar link is clicked.
export function PageLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading page">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="h-4 w-80 rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-24 rounded-lg bg-muted" />
        <div className="h-24 rounded-lg bg-muted" />
        <div className="h-24 rounded-lg bg-muted" />
      </div>
      <div className="space-y-3">
        <div className="h-10 rounded-md bg-muted" />
        <div className="h-10 rounded-md bg-muted" />
        <div className="h-10 rounded-md bg-muted" />
        <div className="h-10 rounded-md bg-muted" />
      </div>
    </div>
  )
}
