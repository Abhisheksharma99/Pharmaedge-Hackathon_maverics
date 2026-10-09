import { SignificanceBadge, CATEGORY_META } from '@/features/assets/components/badges'
import { TAB_FOR_COLLECTION } from '@/features/assets/components/journey-timeline'
import { formatDate } from '@/lib/format'
import type { Card, OpenRecord, TimelineCardEvent } from '../../api'

type TimelineCardData = Extract<Card, { type: 'timeline' }>

/** The source record behind an event, when an asset tab can show it. */
function recordFor(e: TimelineCardEvent): OpenRecord | null {
  const source = e.sources[0]
  const tab = source && TAB_FOR_COLLECTION[source.collection]
  return source && tab ? { assetId: e.assetId, tab, recordKey: source.record_key } : null
}

/** Compact dated list of journey events; each opens its source record. */
export function TimelineCard({ card, onOpenRecord }: { card: TimelineCardData; onOpenRecord: (r: OpenRecord) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <p className="border-b border-[#eef0f3] bg-[#f9fafb] px-3 py-2 text-[12.5px] font-semibold">{card.title}</p>
      <ul className="divide-y divide-[#eef0f3]">
        {card.events.map((e) => {
          const record = recordFor(e)
          return (
            <li key={e.id}>
              <button
                type="button"
                disabled={!record}
                onClick={() => record && onOpenRecord(record)}
                className="flex w-full items-start gap-3 px-3 py-2 text-left enabled:hover:bg-accent/60"
              >
                <span className="w-[76px] shrink-0 font-mono text-xs leading-5 text-muted-foreground">{formatDate(e.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 font-medium text-foreground">{e.title}</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {[CATEGORY_META[e.category]?.label ?? e.category, e.assetName, e.is_milestone && 'Upcoming'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <SignificanceBadge value={e.significance} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
