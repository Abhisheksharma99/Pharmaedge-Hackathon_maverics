import { ArrowRight, Plus, Sparkle } from 'lucide-react'
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
    <section aria-labelledby="ask-card-title" className="flex flex-col gap-[12px] rounded-[14px] border bg-card px-[20px] py-[18px] shadow-panel">
      <div className="flex items-center gap-[12px]">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-[9px] bg-violet-soft text-violet">
          <Sparkle className="size-[16px]" />
        </span>
        <div>
          <h3 id="ask-card-title" className="text-[15px] font-semibold">
            Asset AI
          </h3>
          <p className="text-text-secondary">Answers cite the records behind them.</p>
        </div>
      </div>
      <div className="flex flex-col gap-[6px]">
        {questions.map((q) => (
          <Link
            key={q}
            to={`/chat?ask=${encodeURIComponent(q)}`}
            className="flex items-center justify-between gap-[10px] rounded-[10px] border bg-card px-[12px] py-[10px] text-secondary-foreground transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
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
