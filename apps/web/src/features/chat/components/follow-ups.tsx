/** "Ask next": one-click follow-up pills above the composer (prototype `.ch-fu`). */
export function FollowUps({ questions, onAsk, disabled }: { questions: string[]; onAsk: (q: string) => void; disabled?: boolean }) {
  if (questions.length === 0) return null
  return (
    <div role="group" aria-label="Ask next" className="flex flex-wrap justify-center gap-[6px]">
      {questions.map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onAsk(q)}
          className="rounded-full border bg-card px-[11px] py-[5px] text-[12.5px] text-secondary-foreground transition-colors outline-none hover:border-primary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-primary/12 disabled:opacity-50"
        >
          {q}
        </button>
      ))}
    </div>
  )
}
