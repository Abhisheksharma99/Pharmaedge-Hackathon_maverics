import { ArrowRight, Plus, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

/** Home "Asset AI" starters (README §5.2); `compare` = [primary, competitor] names when a competitor is tracked. */
export function AskCard({ compare }: { compare: [string, string] | null }) {
  const questions = [
    'Which assets have milestones in the next six months?',
    'What changed across my assets this month?',
    compare ? `Compare ${compare[0]} with ${compare[1]}` : 'Compare my assets with their closest competitors',
    'Summarize the latest Phase 3 readouts',
  ]
  return (
    <section aria-labelledby="ask-card-title" className="flex flex-col gap-3 rounded-[14px] border bg-card px-5 py-[18px] shadow-panel">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-violet-soft text-violet">
          <Sparkles className="size-4" />
        </span>
        <div>
          <h3 id="ask-card-title" className="text-[15px] font-semibold">
            Asset AI
          </h3>
          <p className="text-text-secondary">Answers cite the records behind them.</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {questions.map((q) => (
          <Link
            key={q}
            to={`/chat?ask=${encodeURIComponent(q)}`}
            className="flex items-center justify-between gap-2.5 rounded-[10px] border bg-card px-3 py-2.5 text-secondary-foreground transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
          >
            {q}
            <ArrowRight className="size-[13px] shrink-0" />
          </Link>
        ))}
      </div>
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link to="/chat?intent=add">
          <Plus /> Add an asset by chatting
        </Link>
      </Button>
    </section>
  )
}
