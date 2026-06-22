import { ShieldOff } from 'lucide-react'

interface AccessDeniedProps {
  message?: string
}

export function AccessDenied({ message = "You don't have permission to access this page." }: AccessDeniedProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center">
      <ShieldOff className="w-12 h-12 text-muted-foreground" />
      <div>
        <h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
