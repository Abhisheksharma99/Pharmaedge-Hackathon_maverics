import { History, Pencil, Plus, Search, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { InlineError } from '@/components/inline-error'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssets } from '@/features/assets/api'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useChatSessions, useRenameChatSession, type ChatSession } from '../api'
import { filterSessions } from '../session-filter'
import { DeleteChatDialog } from './delete-chat-dialog'

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
const TITLE_MAX = 120

/** "Today", "Yesterday" or "Oct 2" (prototype history rows). */
function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (sameDay(d, now)) return 'Today'
  if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The title being edited in place: Enter or leaving the field saves, Escape cancels. */
function RenameField({ session, onDone }: { session: ChatSession; onDone: () => void }) {
  const rename = useRenameChatSession()
  const [value, setValue] = useState(session.title || 'New chat')
  const done = useRef(false)
  const commit = () => {
    if (done.current) return
    done.current = true
    const title = value.replace(/\s+/g, ' ').trim()
    onDone()
    if (!title || title === session.title) return
    rename.mutate(
      { id: session.id, title: title.slice(0, TITLE_MAX) },
      { onError: (err) => toast.error(err instanceof ApiError ? err.message : 'The chat couldn’t be renamed. Try again.') },
    )
  }
  return (
    <input
      autoFocus
      aria-label="Chat title"
      value={value}
      maxLength={TITLE_MAX}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          done.current = true
          onDone()
        }
      }}
      className="m-[4px] h-[32px] w-[calc(100%-8px)] rounded-[6px] border border-primary bg-background px-[8px] font-medium ring-[3px] ring-primary/12 outline-none"
    />
  )
}

/** New chat, a search over the titles, and the chats (newest first) to open, rename or delete. */
function HistoryList({ currentId, onOpen }: { currentId: string | null; onOpen?: () => void }) {
  const sessions = useChatSessions()
  const assets = useAssets()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const assetName = new Map(assets.data?.map((a) => [a.id, a.name]))
  const shown = filterSessions(sessions.data ?? [], query, (id) => assetName.get(id))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-hidden px-[10px] py-[14px]">
      <Button asChild variant="outline" size="sm" className="mx-[4px] mb-[10px] justify-start">
        <Link to="/chat" onClick={onOpen}>
          <Plus /> New chat
        </Link>
      </Button>
      <div className="relative mx-[4px] mb-[6px]">
        <Search className="pointer-events-none absolute top-1/2 left-[9px] size-[14px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search chats"
          placeholder="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          className="h-[32px] w-full rounded-[8px] border bg-background pr-[30px] pl-[30px] text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/12 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery('')}
            className="absolute top-1/2 right-[6px] flex size-[20px] -translate-y-1/2 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-[13px]" />
          </button>
        )}
      </div>
      <p className="mx-[10px] mt-[6px] mb-[4px] text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {query ? `${shown.length} of ${sessions.data?.length ?? 0} chats` : 'Recent'}
      </p>
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
        {sessions.data && sessions.data.length > 0 && shown.length === 0 && (
          <p className="px-[8px] text-muted-foreground">No chats match “{query.trim()}”.</p>
        )}
        <ul className="space-y-[2px]">
          {shown.map((s) => (
            <li key={s.id} className={cn('group relative rounded-[8px] hover:bg-accent', s.id === currentId && 'bg-accent')}>
              {editing === s.id ? (
                <RenameField session={s} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <Link
                    to={`/chat/${encodeURIComponent(s.id)}`}
                    aria-current={s.id === currentId ? 'page' : undefined}
                    onClick={onOpen}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      setEditing(s.id)
                    }}
                    className="flex min-w-0 flex-col gap-[3px] rounded-[8px] px-[10px] py-[8px] [@media(hover:none)]:pr-[66px]"
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
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Rename chat “${s.title || 'New chat'}”`}
                    onClick={() => setEditing(s.id)}
                    className="absolute top-1/2 right-[34px] -translate-y-1/2 bg-accent text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <Pencil />
                  </Button>
                  <DeleteChatDialog session={s} onDeleted={() => s.id === currentId && navigate('/chat')} />
                </>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

/** The user's chats beside the conversation (wide screens). */
export function ChatHistory({ currentId }: { currentId: string | null }) {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r bg-card min-[901px]:flex">
      <HistoryList currentId={currentId} />
    </aside>
  )
}

/** "Chats" button for narrow screens, where the history column is hidden: the same list in a sheet. */
export function ChatHistorySheet({ currentId }: { currentId: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-[32px] gap-[6px] px-[10px] min-[901px]:hidden">
          <History aria-hidden="true" /> Chats
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[300px] max-w-[85vw] gap-0 p-0 pt-[40px]">
        <SheetTitle className="sr-only">Chat history</SheetTitle>
        <SheetDescription className="sr-only">Search, open, rename or delete your chats.</SheetDescription>
        <HistoryList currentId={currentId} onOpen={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
