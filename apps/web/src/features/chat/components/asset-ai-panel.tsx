import { Maximize2, Sparkles, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { AssetDetail } from '@/features/assets/api'
import { useChatSessions, useCreateChatSession } from '../api'
import { ChatConversation } from './chat-conversation'

const defaultQuestions = (name: string) => [
  `What are the next milestones for ${name}?`,
  `Summarize the latest clinical evidence for ${name}`,
  `How does ${name} compare with its competitors?`,
  `What changed for ${name} in the last 90 days?`,
]

function ContextChip({ children, dot }: { children: React.ReactNode; dot?: boolean }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 font-medium text-secondary-foreground">
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />}
      {children}
    </span>
  )
}

/** Asset AI beside an asset page: continues the asset's latest chat, or starts one on the first question. */
export function AssetAiPanel({ asset, onClose }: { asset: AssetDetail; onClose: () => void }) {
  const sessions = useChatSessions(asset.id)
  const createSession = useCreateChatSession()
  const navigate = useNavigate()
  const sessionId = sessions.data?.[0]?.id ?? null
  const suggestions = asset.suggestedQuestions?.length ? asset.suggestedQuestions : defaultQuestions(asset.name)

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-start justify-between gap-3 px-5 pt-[18px]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] leading-[22px] font-semibold">Asset AI</h2>
              <span className="inline-flex h-5 items-center rounded-md bg-[#eef2fd] px-1.5 text-[12px] font-semibold text-primary">Beta</span>
            </div>
            <p className="text-[12.5px] text-text-secondary">Your copilot for asset intelligence</p>
          </div>
        </div>
        <div className="-mt-1.5 -mr-2.5 flex gap-0.5">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Open Asset AI full screen"
            className="size-10 rounded-[10px] text-text-secondary"
            onClick={() => navigate(sessionId ? `/chat/${encodeURIComponent(sessionId)}` : '/chat')}
          >
            <Maximize2 />
          </Button>
          <Button variant="ghost" size="icon-lg" aria-label="Close Asset AI" className="size-10 rounded-[10px] text-text-secondary" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#eef0f3] px-5 pt-4 pb-3 text-[12px] text-text-secondary">
        <span>Context</span>
        <ContextChip dot>{asset.name}</ContextChip>
        {asset.competitors?.length > 0 && <ContextChip>Competitors</ContextChip>}
      </div>
      {sessions.isPending ? (
        <div className="space-y-2 px-5 py-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <ChatConversation
          sessionId={sessionId}
          createSession={async () => (await createSession.mutateAsync(asset.id)).id}
          suggestions={suggestions}
          emptyPlaceholder={`Ask about ${asset.name}…`}
          contentClassName="px-5"
        />
      )}
    </div>
  )
}
