import { useCallback } from 'react'
import type { Citation, ChatMessage, OpenRecord } from '../api'
import { AssistantMark } from './assistant-mark'
import { ChatCard } from './cards/chat-card'
import { ChatMarkdown } from './chat-markdown'
import { SourcesList } from './sources-list'

/** A persisted answer: markdown with citations, its cards, then its sources. */
export function AssistantMessage({
  message,
  sessionId,
  startedAssets,
  onOpenRecord,
}: {
  message: ChatMessage
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
      </div>
    </div>
  )
}
