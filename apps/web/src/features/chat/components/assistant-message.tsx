import { useCallback } from 'react'
import type { Citation, ChatMessage, OpenRecord } from '../api'
import { AnswerActions } from './answer-actions'
import { AssistantMark } from './assistant-mark'
import { ChatCard } from './cards/chat-card'
import { ChatMarkdown } from './chat-markdown'
import { SourcesList } from './sources-list'

/** A persisted answer: markdown with citations, its cards, its sources, then its actions (copy, save, feedback). */
export function AssistantMessage({
  message,
  question,
  sessionId,
  startedAssets,
  onOpenRecord,
}: {
  message: ChatMessage
  /** The question this answers (null when none came before it). */
  question: string | null
  sessionId: string
  startedAssets: ReadonlySet<string>
  onOpenRecord: (r: OpenRecord) => void
}) {
  const openCitation = useCallback(
    (c: Citation) => onOpenRecord({ assetId: c.assetId, tab: c.tab, recordKey: c.recordKey }),
    [onOpenRecord],
  )
  return (
    <div className="flex items-start gap-[10px]">
      <AssistantMark />
      <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
        {message.content && <ChatMarkdown content={message.content} citations={message.citations} onCite={openCitation} />}
        {message.cards.map((card, i) => (
          <ChatCard key={i} card={card} sessionId={sessionId} startedAssets={startedAssets} />
        ))}
        {message.citations.length > 0 && <SourcesList citations={message.citations} onOpen={openCitation} />}
        {!message.id.startsWith('local-') && (message.content || message.cards.length > 0) && (
          <AnswerActions message={message} question={question} sessionId={sessionId} />
        )}
      </div>
    </div>
  )
}
