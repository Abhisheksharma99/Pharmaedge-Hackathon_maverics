import { Loader2 } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth, type Role } from './use-auth'

function FullPageSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center text-muted-foreground" role="status" aria-label="Loading">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

/** Wraps every signed-in route. */
export function ProtectedRoute() {
  const { user, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return <FullPageSpinner />
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />
  }
  return <Outlet />
}

/** Wraps routes limited to some roles (inside ProtectedRoute). */
export function RoleRoute({ roles }: { roles: Role[] }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />
  return <Outlet />
}
