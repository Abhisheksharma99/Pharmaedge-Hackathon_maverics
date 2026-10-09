import { Activity, Bell, Check, Flag, MessageCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMarkNotificationsRead, useNotifications, type AppNotification } from '@/features/me/api'
import { timeAgo } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { internalPath } from './internal-path'

const KIND: Record<string, { icon: LucideIcon; tone: string }> = {
  onboarding_started: { icon: Activity, tone: 'bg-primary-soft text-primary' },
  onboarding_finished: { icon: Check, tone: 'bg-success-soft text-success' },
  job_failed: { icon: TriangleAlert, tone: 'bg-danger-soft text-destructive' },
  high_event: { icon: Flag, tone: 'bg-warning-soft text-warning' },
  comment: { icon: MessageCircle, tone: 'bg-violet-soft text-violet' },
}
const OTHER = { icon: Bell, tone: 'bg-muted text-text-secondary' }

/** Bell with unread badge and a 350px list (README §5.1). */
export function NotificationsPopover() {
  const list = useNotifications()
  const markRead = useMarkNotificationsRead()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const unread = list.data?.unread ?? 0
  const items = list.data?.items ?? []

  const follow = (n: AppNotification) => {
    setOpen(false)
    if (!n.read) markRead.mutate({ ids: [n.id] })
    const path = internalPath(n.link)
    if (path) navigate(path)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-accent"
      >
        <Bell className="size-[17px]" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-2 border-card bg-destructive px-1 text-[10px] font-semibold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[350px] overflow-hidden rounded-xl border bg-popover shadow-popover outline-none data-[state=open]:animate-fade-up"
        >
          <div className="flex items-center justify-between border-b border-hair px-3.5 py-3">
            <p className="font-semibold">Notifications</p>
            <button
              type="button"
              disabled={!unread}
              onClick={() => markRead.mutate({})}
              className="text-[12.5px] font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          {list.isError && <p className="px-3.5 py-6 text-center text-muted-foreground">Notifications couldn't be loaded.</p>}
          {list.data && items.length === 0 && (
            <div className="px-6 py-8 text-center">
              <p className="font-medium">You're all caught up</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">Finished and failed crawls and new high-significance events show up here.</p>
            </div>
          )}
          <ul className="max-h-[420px] divide-y divide-hair overflow-y-auto">
            {items.map((n) => {
              const kind = KIND[n.kind] ?? OTHER
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => follow(n)} className="flex w-full items-start gap-2.5 px-3.5 py-[11px] text-left transition-colors hover:bg-background">
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', kind.tone)}>
                      <kind.icon className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-semibold">
                        {!n.read && <span role="img" aria-label="Unread" className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-[2px]" />}
                        {n.title}
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground">{n.sub}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] whitespace-nowrap text-faint">{timeAgo(n.at)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
