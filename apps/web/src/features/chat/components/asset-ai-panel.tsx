import { Maximize2, Sparkle, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { InlineError } from '@/components/inline-error'
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
    <span className="inline-flex h-[24px] items-center gap-[6px] rounded-md border px-[8px] font-medium text-secondary-foreground">
      {dot && <span aria-hidden="true" className="size-[6px] rounded-full bg-primary" />}
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
      <div className="flex items-start justify-between gap-[12px] px-[20px] pt-[18px]">
        <div className="flex min-w-0 items-center gap-[12px]">
          <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
            <Sparkle className="size-[20px]" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-[8px]">
              <h2 className="text-[16px] leading-[22px] font-semibold">Asset AI</h2>
              <span className="inline-flex h-[20px] items-center rounded-md bg-primary-soft px-[6px] text-[12px] font-semibold text-primary">Beta</span>
            </div>
            <p className="text-[12.5px] text-text-secondary">Your copilot for asset intelligence</p>
          </div>
        </div>
        <div className="-mt-[6px] -mr-[10px] flex gap-[2px]">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Open Asset AI full screen"
            className="size-[40px] rounded-[10px] text-text-secondary"
            onClick={() => navigate(sessionId ? `/chat/${encodeURIComponent(sessionId)}` : '/chat')}
          >
            <Maximize2 />
          </Button>
          <Button variant="ghost" size="icon-lg" aria-label="Close Asset AI" className="size-[40px] rounded-[10px] text-text-secondary" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[6px] border-b border-hair px-[20px] pt-[16px] pb-[12px] text-[12px] text-text-secondary">
        <span>Context</span>
        <ContextChip dot>{asset.name}</ContextChip>
        {asset.competitors?.length > 0 && <ContextChip>Competitors</ContextChip>}
      </div>
      {sessions.isError ? (
        <InlineError message="Asset AI couldn’t load this asset’s chats." onRetry={() => void sessions.refetch()} />
      ) : sessions.isPending ? (
        <div className="space-y-[8px] px-[20px] py-[20px]">
          <Skeleton className="h-[40px] w-full" />
          <Skeleton className="h-[40px] w-full" />
        </div>
      ) : (
        <ChatConversation
          sessionId={sessionId}
          createSession={async () => (await createSession.mutateAsync(asset.id)).id}
          suggestions={suggestions}
          emptyPlaceholder={`Ask about ${asset.name}…`}
          contentClassName="px-[20px]"
        />
      )}
    </div>
  )
}
