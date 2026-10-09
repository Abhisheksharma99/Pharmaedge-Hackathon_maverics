import { Search } from 'lucide-react'

/** "Ask next": one-click follow-up questions. */
export function FollowUps({ questions, onAsk, disabled }: { questions: string[]; onAsk: (q: string) => void; disabled?: boolean }) {
  if (questions.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Ask next</p>
      {questions.map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onAsk(q)}
          className="flex min-h-10 items-center gap-2.5 rounded-[10px] border bg-card px-3 py-2 text-left font-medium text-secondary-foreground transition-colors hover:bg-accent/50 disabled:opacity-50"
        >
          <Search className="size-[15px] shrink-0 text-muted-foreground" />
          {q}
        </button>
      ))}
    </div>
  )
}
