import { Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssets } from '@/features/assets/api'
import { cn } from '@/lib/utils'
import { useChatSessions } from '../api'
import { DeleteChatDialog } from './delete-chat-dialog'

/** The user's chats, newest first, with New chat. */
export function ChatHistory({ currentId }: { currentId: string | null }) {
  const sessions = useChatSessions()
  const assets = useAssets()
  const navigate = useNavigate()
  const assetName = new Map(assets.data?.map((a) => [a.id, a.name]))

  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r bg-card md:flex">
      <div className="p-3">
        <Button asChild className="h-9 w-full rounded-[10px]">
          <Link to="/chat">
            <Plus /> New chat
          </Link>
        </Button>
      </div>
      <p className="px-4 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">History</p>
      <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sessions.isPending && (
          <div className="space-y-1.5 px-1">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}
        {sessions.isError && <p className="px-2 text-destructive">Chats couldn’t be loaded.</p>}
        {sessions.data?.length === 0 && <p className="px-2 text-muted-foreground">No chats yet.</p>}
        <ul className="space-y-0.5">
          {sessions.data?.map((s) => (
            <li key={s.id} className="group flex items-center gap-1 rounded-md pr-1 hover:bg-accent/60">
              <Link
                to={`/chat/${encodeURIComponent(s.id)}`}
                aria-current={s.id === currentId ? 'page' : undefined}
                className={cn(
                  'flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2.5 py-2',
                  s.id === currentId && 'bg-accent font-medium',
                )}
              >
                <span className="truncate">{s.title || 'New chat'}</span>
                {s.assetId && (
                  <span className="w-max max-w-full truncate rounded bg-[#eef2fd] px-1.5 text-[11px] font-medium text-primary">
                    {assetName.get(s.assetId) ?? s.assetId}
                  </span>
                )}
              </Link>
              <DeleteChatDialog session={s} onDeleted={() => s.id === currentId && navigate('/chat')} />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
