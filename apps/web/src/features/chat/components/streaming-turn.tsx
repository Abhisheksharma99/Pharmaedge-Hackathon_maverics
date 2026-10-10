import { Loader2 } from 'lucide-react'
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
  onRetry,
}: {
  turn: Turn
  sessionId: string
  startedAssets: ReadonlySet<string>
  onRetry: () => void
}) {
  const streaming = turn.status === 'streaming'
  return (
    <>
      <UserMessage text={turn.userText} />
      <div className="flex items-start gap-[10px]" aria-busy={streaming}>
        <AssistantMark />
        <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
          {turn.tools.length > 0 && <ToolActivityList tools={turn.tools} streaming={streaming} />}
          {streaming && !turn.text && turn.tools.length === 0 && (
            <p className="inline-flex items-center gap-[8px] text-muted-foreground">
              <Loader2 className="size-[14px] animate-spin" /> Thinking…
            </p>
          )}
          {turn.text && <ChatMarkdown content={turn.text} citations={NO_CITATIONS} onCite={noop} streaming={streaming} />}
          {turn.cards.map((card, i) => (
            <ChatCard key={i} card={card} sessionId={sessionId} startedAssets={startedAssets} />
          ))}
          {turn.status !== 'streaming' && <TurnStatus status={turn.status} error={turn.error} onRetry={onRetry} />}
        </div>
      </div>
    </>
  )
}
