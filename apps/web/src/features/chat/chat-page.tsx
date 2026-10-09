import { Sparkles } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useChatSessions, useCreateChatSession } from './api'
import { ChatConversation } from './components/chat-conversation'
import { ADD_ASSET_DRAFT, ChatEmptyState } from './components/chat-empty-state'
import { ChatHistory } from './components/chat-history'

const PORTFOLIO_QUESTIONS = [
  'What changed across my assets this month?',
  'Which upcoming milestones should I watch?',
  'Compare my assets with their closest competitors',
]

/** Full-page Asset AI (`/chat`, `/chat/:sessionId`); `?intent=add` starts with "Add " in the composer. */
export function ChatPage() {
  const { sessionId = null } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const sessions = useChatSessions()
  const createSession = useCreateChatSession()
  const addIntent = sessionId === null && params.get('intent') === 'add'
  const title = sessionId ? (sessions.data?.find((s) => s.id === sessionId)?.title ?? '') : ''

  return (
    <div className="flex h-full min-h-0">
      <ChatHistory currentId={sessionId} />
      <section aria-label="Asset AI" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-6">
          <Sparkles className="size-4 text-primary" />
          <h1 className="font-semibold">Asset AI</h1>
          <span className="inline-flex h-5 items-center rounded-md bg-[#eef2fd] px-1.5 text-[12px] font-semibold text-primary">Beta</span>
          {title && <span className="min-w-0 truncate text-text-secondary">· {title}</span>}
        </div>
        <ChatConversation
          key={`${sessionId ?? 'new'}${addIntent ? ':add' : ''}`}
          sessionId={sessionId}
          createSession={async () => (await createSession.mutateAsync(undefined)).id}
          onSessionCreated={(id) => navigate(`/chat/${encodeURIComponent(id)}`)}
          suggestions={PORTFOLIO_QUESTIONS}
          EmptyState={ChatEmptyState}
          emptyPlaceholder="Ask about your assets, or type “Add” and a drug name…"
          initialDraft={addIntent ? ADD_ASSET_DRAFT : ''}
          autoFocus={addIntent}
          contentClassName="mx-auto w-full max-w-[760px] px-6"
        />
      </section>
    </div>
  )
}
