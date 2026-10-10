import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { InlineError } from '@/components/inline-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssets } from '@/features/assets/api'
import { cn } from '@/lib/utils'
import { useChatSessions } from '../api'
import { DeleteChatDialog } from './delete-chat-dialog'

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** "Today", "Yesterday" or "Oct 2" (prototype history rows). */
function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (sameDay(d, now)) return 'Today'
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The user's chats, newest first, with New chat. */
export function ChatHistory({ currentId }: { currentId: string | null }) {
  const sessions = useChatSessions()
  const assets = useAssets()
  const navigate = useNavigate()
  const assetName = new Map(assets.data?.map((a) => [a.id, a.name]))

  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r bg-card min-[901px]:flex">
      <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-hidden px-[10px] py-[14px]">
        <Button asChild variant="outline" size="sm" className="mx-[4px] mb-[10px] justify-start">
          <Link to="/chat">
            <Plus /> New chat
          </Link>
        </Button>
        <p className="mx-[10px] mt-[6px] mb-[4px] text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Recent</p>
      <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto">
        {sessions.isPending && (
          <div className="space-y-[6px] px-[4px]">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[36px] w-full" />
            ))}
          </div>
        )}
        {sessions.isError && <InlineError message="Chats couldn’t be loaded." onRetry={() => void sessions.refetch()} className="px-[8px] py-[4px]" />}
        {sessions.data?.length === 0 && <p className="px-[8px] text-muted-foreground">No chats yet.</p>}
        <ul className="space-y-[2px]">
          {sessions.data?.map((s) => (
            <li key={s.id} className={cn("group relative rounded-[8px] hover:bg-accent", s.id === currentId && "bg-accent")}>
              <Link
                to={`/chat/${encodeURIComponent(s.id)}`}
                aria-current={s.id === currentId ? 'page' : undefined}
                className={cn(
                  'flex min-w-0 flex-col gap-[3px] rounded-[8px] px-[10px] py-[8px]',
                )}
              >
                <span className="truncate font-medium">{s.title || 'New chat'}</span>
                <span className="flex items-center gap-[6px] text-[11.5px] text-muted-foreground">
                  {s.assetId && (
                    <span className="max-w-[120px] truncate rounded-[5px] bg-muted px-[6px] py-px text-[11px] whitespace-nowrap text-secondary-foreground">
                      {assetName.get(s.assetId) ?? s.assetId}
                    </span>
                  )}
                  <span className="whitespace-nowrap">{when(s.updatedAt)}</span>
                </span>
              </Link>
              <DeleteChatDialog session={s} onDeleted={() => s.id === currentId && navigate('/chat')} />
            </li>
          ))}
        </ul>
      </nav>
      </div>
    </aside>
  )
}
