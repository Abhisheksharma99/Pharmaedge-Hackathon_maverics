import { CategoryIcon } from '@/features/assets/components/badges'
import { formatDay, formatMonth } from '@/lib/dates'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { Card } from '../../api'

type TimelineCardData = Extract<Card, { type: 'timeline' }>

/**
 * Dated journey events as a numbered answer list (prototype `.ans-l`): category icon, title, "asset · date",
 * and a numbered cite chip that opens the event detail sheet. Milestones read "expected Mon yyyy".
 */
export function TimelineCard({ card }: { card: TimelineCardData }) {
  const openEvent = useEventSheet((s) => s.openEvent)
  return (
    <ol aria-label={card.title} className="flex flex-col gap-[6px]">
      {card.events.map((e, i) => (
        <li
          key={e.id}
          style={{ animationDelay: `${i * 90}ms` }}
          className="flex animate-fade-up items-center gap-[10px] rounded-[10px] border bg-card px-[10px] py-[8px]"
        >
          <CategoryIcon category={e.category} className="size-[22px]" />
          <span className="min-w-0 flex-1">
            <b className="font-medium">{e.title}</b>
            <span className="text-muted-foreground">
              {' '}
              · {e.assetName} · {e.is_milestone ? `expected ${formatMonth(e.date)}` : formatDay(e.date)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => openEvent(e.assetId, e.id)}
            aria-label={`Open event ${i + 1}: ${e.title}`}
            className="size-[20px] shrink-0 rounded-[6px] border border-[#c7d1f4] bg-primary-soft p-0 text-[11px] font-semibold text-primary outline-none hover:bg-primary hover:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-primary/12"
          >
            {i + 1}
          </button>
        </li>
      ))}
    </ol>
  )
}
