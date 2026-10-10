import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { InlineError } from '@/components/inline-error'
import { Page } from '@/components/layout/page'
import { initials } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/auth-context'
import { Panel } from '@/features/assets/components/panel'
import { usePrefs, useSavePrefs, type Prefs } from '@/features/me/api'
import { useUsers } from './users-api'

const TAG = 'rounded-[5px] bg-muted px-[6px] py-px text-[11px] whitespace-nowrap text-secondary-foreground capitalize'
const AVATAR = 'flex shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground'

const TOGGLES: { key: keyof Prefs['notify']; label: string }[] = [
  { key: 'highEvents', label: 'High-significance events on my assets' },
  { key: 'crawls', label: 'Crawl finished or failed' },
  { key: 'weeklyDigest', label: 'Weekly portfolio digest by email' },
]

function Notifications() {
  const prefs = usePrefs()
  const save = useSavePrefs()
  return (
    <Panel title="Notifications" description="What PharmaEdge tells you about">
      {prefs.isError && <InlineError message="Your notification settings couldn't be loaded." onRetry={() => void prefs.refetch()} />}
      <div className="flex flex-col gap-[14px] px-[20px] py-[16px]">
        {TOGGLES.map((t) => (
          <label key={t.key} className="inline-flex cursor-pointer items-center gap-[8px] self-start text-text-secondary">
            <Switch
              checked={prefs.data?.notify[t.key] ?? false}
              disabled={!prefs.data}
              onCheckedChange={(v) => save.mutate({ notify: { [t.key]: v } }, { onError: () => toast.error("Couldn't save that change. Try again.") })}
            />
            {t.label}
          </label>
        ))}
      </div>
    </Panel>
  )
}

function Team() {
  const users = useUsers()
  const list = users.data ?? []
  return (
    <Panel
      title="Team"
      description={users.data ? `${list.length} member${list.length === 1 ? '' : 's'}` : undefined}
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/settings/users">
            <Plus /> Invite
          </Link>
        </Button>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.isPending &&
            [0, 1, 2].map((i) => (
              <TableRow key={i}>
                <TableCell colSpan={3}>
                  <Skeleton className="h-[28px] w-full" />
                </TableCell>
              </TableRow>
            ))}
          {users.isError && (
            <TableRow>
              <TableCell colSpan={3} className="p-0">
                <InlineError message="The team couldn't be loaded." onRetry={() => void users.refetch()} />
              </TableCell>
            </TableRow>
          )}
          {list.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <div className="flex items-center gap-[10px]">
                  <span className={`${AVATAR} size-[28px]`}>{initials(u.name)}</span>
                  <b className="font-medium">{u.name}</b>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{u.email}</TableCell>
              <TableCell>
                <span className={TAG}>{u.role}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  )
}

/** Settings (README §5.8): profile, notification toggles, and the team for admins. */
export function SettingsPage() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <Page title="Settings" description="Your profile, notifications and team.">
      <div className="flex flex-col gap-[20px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-[20px]">
          <Panel title="Profile">
            <div className="flex items-center gap-[14px] px-[20px] py-[18px]">
              <span className={`${AVATAR} size-[52px] rounded-[8px] text-[17px]`}>{initials(user.name)}</span>
              <div>
                <b className="font-semibold">{user.name}</b>
                <p className="mt-[2px] mb-[6px] text-muted-foreground">{user.email}</p>
                <span className={TAG}>{user.role}</span>
              </div>
            </div>
          </Panel>
          <Notifications />
        </div>
        {user.role === 'admin' && <Team />}
      </div>
    </Page>
  )
}
