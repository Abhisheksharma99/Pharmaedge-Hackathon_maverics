import { Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import type { ConversationActions } from './chat-conversation'

/** Composer text for adding an asset ("Add sotatercept"). */
export const ADD_ASSET_DRAFT = 'Add '

const STARTERS = [
  'Which assets have milestones in the next six months?',
  'What were the most significant regulatory events this year?',
  'Which competitors are closest to approval?',
  'Summarize the latest Phase 3 readouts across my assets',
]

/** First screen of a new chat: greeting, portfolio starters and "Add an asset". */
export function ChatEmptyState({ ask, prefill }: ConversationActions) {
  const { user } = useAuth()
  const firstName = user?.name.split(/\s+/)[0]
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <Sparkles className="size-6" />
      </span>
      <h2 className="mt-4 text-[22px] font-semibold tracking-tight">
        {firstName ? `Hi ${firstName}, what would you like to know?` : 'What would you like to know?'}
      </h2>
      <p className="mt-1 max-w-md text-text-secondary">
        Ask about your assets, their competitors and the evidence behind them, or add a new asset to track.
      </p>
      <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
        {STARTERS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => ask(q)}
            className="rounded-xl border bg-card px-3.5 py-3 text-left font-medium text-secondary-foreground transition-colors hover:bg-accent/50"
          >
            {q}
          </button>
        ))}
      </div>
      <Button variant="outline" className="mt-4 h-9 rounded-[10px] bg-card" onClick={() => prefill(ADD_ASSET_DRAFT)}>
        <Plus /> Add an asset
      </Button>
    </div>
  )
}
