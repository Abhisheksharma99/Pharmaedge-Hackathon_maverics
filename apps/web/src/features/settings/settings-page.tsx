import { Users } from 'lucide-react'
import { Link } from 'react-router'
import { Page } from '@/components/layout/page'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/features/auth/auth-context'

export function SettingsPage() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <Page title="Settings">
      <div className="grid max-w-3xl gap-4">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-medium">Profile</h2>
          <dl className="grid grid-cols-[120px_1fr] gap-y-2">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>
              <Badge variant="secondary" className="capitalize">
                {user.role}
              </Badge>
            </dd>
          </dl>
        </section>
        {user.role === 'admin' && (
          <Link to="/settings/users" className="flex items-center gap-3 rounded-xl border bg-card p-5 hover:bg-accent/50">
            <Users className="size-5 text-primary" />
            <div>
              <p className="font-medium">Users</p>
              <p className="text-text-secondary">Add people, change roles, deactivate accounts.</p>
            </div>
          </Link>
        )}
      </div>
    </Page>
  )
}
