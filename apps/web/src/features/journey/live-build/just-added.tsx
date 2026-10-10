import { Sparkle } from 'lucide-react'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { formatDay } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { JourneyEventV3 } from '../types'
import { viaLabel } from './build-model'

/**
 * "Just added" under the forming timeline: the five newest events the crawl announced (the crawler announces new
 * High-significance events), newest first; each opens the event sheet.
 */
export function JustAdded({ latest, total, ended }: { latest: JourneyEventV3[]; total: number; ended: boolean }) {
  const openEvent = useEventSheet((s) => s.openEvent)
  return (
    <div className="border-t border-hair px-[16px] pt-[12px] pb-[14px]">
      <div className="mb-[4px] flex justify-between text-[11px] font-semibold tracking-[0.06em] text-text-secondary uppercase">
        <span>Just added</span>
        {total > 0 && <span className="font-mono font-medium tracking-normal text-muted-foreground normal-case">{formatNumber(total)} events</span>}
      </div>
      {latest.length === 0 ? (
        <p className="my-[6px] text-muted-foreground">
          {ended ? 'This crawl added no new high-significance events.' : 'Events appear here once the rules engine starts reading structured records.'}
        </p>
      ) : (
        <ul aria-label="Just added">
          {latest.slice(0, 5).map((e) => (
            <li key={e.id} className="animate-row-in overflow-hidden border-b border-hair last:border-b-0">
              <button type="button" onClick={() => openEvent(e.asset, e.id)} className="flex w-full items-center gap-[10px] rounded-[8px] py-[7px] text-left outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-primary/40">
                <CategoryIcon category={e.category} className="size-[26px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.title}</div>
                  <div className="mt-px flex items-center gap-[8px] text-[12px] text-muted-foreground">
                    <span className="font-mono">{formatDay(e.date)}</span>
                    <span className={cn('inline-flex items-center gap-[4px] whitespace-nowrap', e.via === 'ai_events' && 'text-violet')}>
                      {e.via === 'ai_events' && <Sparkle aria-hidden="true" className="size-[11px]" />}
                      {viaLabel(e)}
                    </span>
                  </div>
                </div>
                <SignificanceBadge value={e.significance} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
