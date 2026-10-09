import { useMemo, useState } from 'react'
import { RecordSheet } from '@/features/assets/components/record-sheet'
import type { ChatMessage, OpenRecord } from '../api'
import type { Turn } from '../turn-store'
import { AssistantMessage } from './assistant-message'
import { StreamingTurn } from './streaming-turn'
import { UserMessage } from './user-message'

/** The conversation so far, plus the turn in flight; cited records open in the record sheet. */
export function ChatThread({
  sessionId,
  messages,
  turn,
  onRetry,
}: {
  sessionId: string
  messages: ChatMessage[]
  turn: Turn | undefined
  onRetry: (text: string) => void
}) {
  const [record, setRecord] = useState<OpenRecord | null>(null)
  // Assets whose crawl was started here: the API appends a job card when Confirm is clicked.
  const startedAssets = useMemo(
    () => new Set(messages.flatMap((m) => m.cards.flatMap((c) => (c.type === 'job' ? [c.assetId] : [])))),
    [messages],
  )
  return (
    <div className="flex flex-col gap-5">
      {messages.map((m) =>
        m.role === 'user' ? (
          <UserMessage key={m.id} text={m.content} />
        ) : (
          <AssistantMessage key={m.id} message={m} sessionId={sessionId} startedAssets={startedAssets} onOpenRecord={setRecord} />
        ),
      )}
      {turn && (
        <StreamingTurn
          turn={turn}
          sessionId={sessionId}
          startedAssets={startedAssets}
          onOpenRecord={setRecord}
          onRetry={() => onRetry(turn.userText)}
        />
      )}
      {record && (
        <RecordSheet assetId={record.assetId} tab={record.tab} recordKey={record.recordKey} onClose={() => setRecord(null)} />
      )}
    </div>
  )
}
