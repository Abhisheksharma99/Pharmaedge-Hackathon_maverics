import { useEffect, useEffectEvent, useRef, useState, type ComponentType } from 'react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useChatMessages } from '../api'
import { useTurn } from '../turn-store'
import { useSendTurn } from '../use-send-turn'
import { ChatThread } from './chat-thread'
import { Composer } from './composer'
import { FollowUps } from './follow-ups'

export interface ConversationActions {
  ask: (question: string) => void
  /** Put text in the composer and focus it. */
  prefill: (text: string) => void
}

/**
 * One chat session: thread, "Ask next" and composer. Without a session yet,
 * the first question creates one (`createSession`) and then streams into it.
 */
export function ChatConversation({
  sessionId,
  createSession,
  onSessionCreated,
  suggestions,
  EmptyState,
  emptyPlaceholder,
  initialDraft = '',
  initialQuestion,
  autoFocus = false,
  contentClassName,
}: {
  sessionId: string | null
  createSession: () => Promise<string>
  onSessionCreated?: (sessionId: string) => void
  /** "Ask next" questions until an answer brings its own follow-ups. */
  suggestions: string[]
  /** Replaces the thread and "Ask next" while the session has no messages. */
  EmptyState?: ComponentType<ConversationActions>
  emptyPlaceholder?: string
  initialDraft?: string
  /** Asked once when the conversation mounts, as if typed (`/chat?ask=`). */
  initialQuestion?: string
  autoFocus?: boolean
  /** Horizontal sizing of the thread and composer columns. */
  contentClassName?: string
}) {
  const turn = useTurn(sessionId)
  const messages = useChatMessages(sessionId, !turn)
  const { send, stop } = useSendTurn()
  const [draft, setDraft] = useState(initialDraft)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const list = messages.data ?? []
  const busy = turn?.status === 'streaming' || creating
  const loading = sessionId !== null && messages.isPending && !turn
  const empty = !loading && list.length === 0 && !turn && !creating
  const lastAnswer = list.findLast((m) => m.role === 'assistant')
  const followUps = lastAnswer?.followUps.length ? lastAnswer.followUps : suggestions

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // The ref keeps React's dev double-mount from asking twice; the effect event always calls the current `ask`.
  const asked = useRef(false)
  const askInitial = useEffectEvent((question: string) => void ask(question))
  useEffect(() => {
    if (!initialQuestion || asked.current) return
    asked.current = true
    askInitial(initialQuestion)
  }, [initialQuestion])

  // Follow the answer as it streams, unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.data, turn])

  async function ask(text: string) {
    setDraft('')
    stickToBottom.current = true
    if (sessionId) return send(sessionId, text)
    setCreating(true)
    try {
      const id = await createSession()
      send(id, text)
      onSessionCreated?.(id)
    } catch (err) {
      setDraft(text)
      toast.error(err instanceof ApiError ? err.message : 'The chat couldn’t be started. Try again.')
    } finally {
      setCreating(false)
    }
  }

  const prefill = (text: string) => {
    setDraft(text)
    inputRef.current?.focus()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className={cn('flex flex-col gap-5 py-5', contentClassName)}>
          {loading && (
            <div className="space-y-3">
              <Skeleton className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {messages.isError && !turn && <p className="text-destructive">This conversation couldn’t be loaded.</p>}
          {empty && EmptyState && <EmptyState ask={ask} prefill={prefill} />}
          {sessionId && (list.length > 0 || turn) && (
            <ChatThread sessionId={sessionId} messages={list} turn={turn} onRetry={(text) => send(sessionId, text)} />
          )}
          {!busy && !loading && !(empty && EmptyState) && (
            <div className={cn(!empty && 'border-t border-[#eef0f3] pt-4')}>
              <FollowUps questions={followUps} onAsk={ask} />
            </div>
          )}
        </div>
      </div>
      <div className={cn('flex flex-col gap-2 pt-2 pb-5', contentClassName)}>
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={ask}
          onStop={() => sessionId && stop(sessionId)}
          streaming={busy}
          placeholder={empty && emptyPlaceholder ? emptyPlaceholder : undefined}
          inputRef={inputRef}
        />
        <p className="text-[12px] text-muted-foreground">AI answers can be wrong. Check the cited evidence before acting.</p>
      </div>
    </div>
  )
}
