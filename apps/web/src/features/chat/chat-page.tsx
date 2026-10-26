import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useCreateChatSession } from './api'
import { ChatConversation } from './components/chat-conversation'
import { ChatEmptyState } from './components/chat-empty-state'
import { ChatExportMenu } from './components/chat-export-menu'
import { ChatHistory, ChatHistorySheet } from './components/chat-history'
import { useStarterQuestions } from './starters'
import { useOfferNavigation } from './navigation'

/**
 * Full-page Asset AI (`/chat`, `/chat/:sessionId`); `?intent=add` focuses the composer and
 * `?ask=<question>` sends the question in a new chat (Home, ⌘K and the starter questions link here).
 */
export function ChatPage() {
  const { sessionId = null } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const starters = useStarterQuestions()
  const createSession = useCreateChatSession()
  const addIntent = sessionId === null && params.get('intent') === 'add'
  const askParam = sessionId === null ? (params.get('ask')?.trim() ?? '') : ''
  useOfferNavigation(sessionId)

  return (
    <div className="flex h-full min-h-0">
      <ChatHistory currentId={sessionId} />
      <section aria-label="Asset AI" className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-[10px] border-b bg-card px-[24px] py-[10px] max-[900px]:px-[16px]">
          <ChatHistorySheet currentId={sessionId} />
          <div className="flex min-w-0 flex-1 items-baseline gap-[10px]">
            <h1 className="shrink-0 font-semibold">Asset AI</h1>
            <span className="truncate text-muted-foreground max-[600px]:hidden">Your copilot for asset intelligence</span>
          </div>
          {sessionId && <ChatExportMenu sessionId={sessionId} />}
        </div>
        <ChatConversation
          key={`${sessionId ?? 'new'}${addIntent ? ':add' : ''}${askParam ? `:ask:${askParam}` : ''}`}
          sessionId={sessionId}
          createSession={async () => (await createSession.mutateAsync(undefined)).id}
          onSessionCreated={(id) => navigate(`/chat/${encodeURIComponent(id)}`, { replace: askParam !== '' })}
          suggestions={starters.slice(0, 3)}
          EmptyState={ChatEmptyState}
          emptyPlaceholder="Ask about your assets, or name a drug to add, e.g. sotatercept"
          initialQuestion={askParam || undefined}
          autoFocus={addIntent}
          contentClassName="mx-auto w-full max-w-[860px] px-[24px] max-[900px]:px-[16px]"
        />
      </section>
    </div>
  )
}
