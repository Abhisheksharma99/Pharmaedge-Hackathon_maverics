import { Loader2 } from 'lucide-react'
import type { OpenRecord } from '../api'
import type { Turn } from '../turn-store'
import { AssistantMark } from './assistant-mark'
import { ChatCard } from './cards/chat-card'
import { ChatMarkdown } from './chat-markdown'
import { ToolActivityList } from './tool-activity'
import { TurnStatus } from './turn-status'
import { UserMessage } from './user-message'

const NO_CITATIONS: never[] = []
const noop = () => {}

/** The question being answered: tool activity, cards and text as they stream in. */
export function StreamingTurn({
  turn,
  sessionId,
  startedAssets,
  onOpenRecord,
  onRetry,
}: {
  turn: Turn
  sessionId: string
  startedAssets: ReadonlySet<string>
  onOpenRecord: (r: OpenRecord) => void
  onRetry: () => void
}) {
  const streaming = turn.status === 'streaming'
  return (
    <>
      <UserMessage text={turn.userText} />
      <div className="flex items-start gap-2.5" aria-busy={streaming}>
        <AssistantMark />
        <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
          {turn.tools.length > 0 && <ToolActivityList tools={turn.tools} streaming={streaming} />}
          {streaming && !turn.text && turn.tools.length === 0 && (
            <p className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </p>
          )}
          {turn.text && <ChatMarkdown content={turn.text} citations={NO_CITATIONS} onCite={noop} streaming={streaming} />}
          {turn.cards.map((card, i) => (
            <ChatCard key={i} card={card} sessionId={sessionId} startedAssets={startedAssets} onOpenRecord={onOpenRecord} />
          ))}
          {turn.status !== 'streaming' && <TurnStatus status={turn.status} error={turn.error} onRetry={onRetry} />}
        </div>
      </div>
    </>
  )
}
