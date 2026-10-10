import { ArrowRight, Plus, Sparkle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ConversationActions } from './chat-conversation'
import { useStarterQuestions } from '../starters'

/** Composer text for adding an asset ("Add sotatercept"). */
export const ADD_ASSET_DRAFT = 'Add '

/** First screen of a new chat (prototype `.ch-empty`): prompt, portfolio starters and "Add an asset". */
export function ChatEmptyState({ ask, prefill }: ConversationActions) {
  const starters = useStarterQuestions()
  return (
    <div className="my-auto flex flex-col items-center gap-[6px] py-[40px] text-center">
      <span className="flex size-[48px] items-center justify-center rounded-[14px] bg-violet-soft text-violet">
        <Sparkle className="size-[22px]" />
      </span>
      <h2 className="mt-[10px] text-[22px] font-semibold tracking-[-0.02em]">What do you want to know?</h2>
      <p className="max-w-[440px] text-text-secondary">
        Ask about your assets, their competitors and the evidence behind them, or add a new asset to track.
      </p>
      <div className="mt-[18px] grid w-full max-w-[620px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[8px]">
        {starters.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => ask(q)}
            className="flex items-center justify-between gap-[10px] rounded-[10px] border bg-card px-[12px] py-[10px] text-left text-secondary-foreground transition-colors outline-none hover:border-primary hover:bg-primary-soft hover:text-primary focus-visible:ring-[3px] focus-visible:ring-primary/12"
          >
            {q}
            <ArrowRight className="size-[13px] shrink-0" />
          </button>
        ))}
      </div>
      <Button variant="outline" size="sm" className="mt-[10px]" onClick={() => prefill(ADD_ASSET_DRAFT)}>
        <Plus /> Add an asset
      </Button>
    </div>
  )
}
