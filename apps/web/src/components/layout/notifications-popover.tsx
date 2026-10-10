import { Activity, Bell, Check, Flag, MessageCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { InlineError } from '@/components/inline-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useMarkNotificationsRead, useNotifications, type AppNotification } from '@/features/me/api'
import { timeAgo } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { internalPath } from './internal-path'

/** One neutral 28px tile for every kind (prototype `.tile.sm`); the icon says what happened. */
const TILE = 'bg-muted text-text-secondary'
const KIND: Record<string, { icon: LucideIcon }> = {
  onboarding_started: { icon: Activity },
  onboarding_finished: { icon: Check },
  job_failed: { icon: TriangleAlert },
  high_event: { icon: Flag },
  comment: { icon: MessageCircle },
}
const OTHER = { icon: Bell }

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
        className="relative flex size-[32px] items-center justify-center rounded-[8px] text-text-secondary outline-none transition-colors hover:bg-accent data-[state=open]:bg-accent focus-visible:ring-[3px] focus-visible:ring-primary/12"
      >
        <Bell className="size-[17px]" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-[2px] right-[2px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-2 border-card bg-destructive px-[4px] text-[10px] font-semibold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[350px] overflow-hidden rounded-[12px] border bg-popover shadow-popover outline-none data-[state=open]:animate-fade-up"
        >
          <div className="flex items-center justify-between border-b border-hair px-[14px] py-[12px]">
            <b className="font-semibold">Notifications</b>
            <button
              type="button"
              disabled={!unread}
              onClick={() => markRead.mutate({})}
              className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          {list.isPending && (
            <div role="status" aria-label="Loading notifications" className="divide-y divide-hair">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-[10px] px-[14px] py-[11px]">
                  <Skeleton className="size-[28px] shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-[6px]">
                    <Skeleton className="h-[13px] w-3/4" />
                    <Skeleton className="h-[11px] w-full" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {list.isError && <InlineError message="Notifications couldn't be loaded." onRetry={() => void list.refetch()} className="justify-center px-[14px] py-[24px]" />}
          {list.data && items.length === 0 && (
            <div className="px-[24px] py-[32px] text-center">
              <p className="font-medium">You're all caught up</p>
              <p className="mt-[4px] text-[12.5px] text-muted-foreground">Finished and failed crawls and new high-significance events show up here.</p>
            </div>
          )}
          <ul className="max-h-[420px] divide-y divide-hair overflow-y-auto">
            {items.map((n) => {
              const kind = KIND[n.kind] ?? OTHER
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => follow(n)} className="flex w-full items-start gap-[10px] px-[14px] py-[11px] text-left transition-colors hover:bg-background">
                    <span className={cn('flex size-[28px] shrink-0 items-center justify-center rounded-lg', TILE)}>
                      <kind.icon className="size-[14px]" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                      <span className="font-medium">
                        {!n.read && <span role="img" aria-label="Unread" className="mr-[6px] inline-block size-[6px] rounded-full bg-primary align-[2px]" />}
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
