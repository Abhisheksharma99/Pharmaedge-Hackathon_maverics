import { Sparkles } from 'lucide-react'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { formatDay } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { JourneyEventV3 } from '../types'
import { viaLabel } from './build-model'

/**
 * "Just added" under the forming timeline: the five newest events the crawl announced (the crawler announces new
 * High-significance events), newest first.
 */
export function JustAdded({ latest, total, ended }: { latest: JourneyEventV3[]; total: number; ended: boolean }) {
  return (
    <div className="border-t border-hair px-4 pt-3 pb-3.5">
      <div className="mb-1 flex justify-between text-[11px] font-semibold tracking-[0.06em] text-text-secondary uppercase">
        <span>Just added</span>
        {total > 0 && <span className="font-mono font-medium tracking-normal text-muted-foreground normal-case">{formatNumber(total)} events</span>}
      </div>
      {latest.length === 0 ? (
        <p className="my-1.5 text-muted-foreground">
          {ended ? 'This crawl added no new high-significance events.' : 'Events appear here once the rules engine starts reading structured records.'}
        </p>
      ) : (
        <ul aria-label="Just added">
          {latest.slice(0, 5).map((e) => (
            <li key={e.id} className="flex animate-row-in items-center gap-2.5 overflow-hidden border-b border-hair py-[7px] last:border-b-0">
              <CategoryIcon category={e.category} className="size-[26px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.title}</div>
                <div className="mt-px flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="font-mono">{formatDay(e.date)}</span>
                  <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', e.via === 'ai_events' && 'text-violet')}>
                    {e.via === 'ai_events' && <Sparkles aria-hidden="true" className="size-[11px]" />}
                    {viaLabel(e)}
                  </span>
                </div>
              </div>
              <SignificanceBadge value={e.significance} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
