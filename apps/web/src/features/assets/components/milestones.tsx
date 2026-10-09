import { useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMonth, formatPhase } from '@/lib/format'
import { useTimeline, type JourneyEvent, type RecordTab } from '../api'
import { CATEGORY_META, SignificanceBadge } from './badges'
import { TAB_FOR_COLLECTION } from './journey-timeline'
import { EmptyState, Panel } from './panel'
import { RecordSheet } from './record-sheet'

/** Trial milestones say which phase completes; others say what kind of milestone they are. */
function detail(m: JourneyEvent): string {
  if (m.type === 'expected_readout') return `${formatPhase(m.phase)} · primary completion`
  return CATEGORY_META[m.category]?.label ?? m.category
}

/** Forward-looking events (expected readouts, filings, decisions, patent expiries), soonest first. */
export function UpcomingMilestones({ assetId }: { assetId: string }) {
  const milestones = useTimeline(assetId, { milestones: 'only', companyOnly: true, limit: 100 })
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<{ tab: RecordTab; key: string } | null>(null)
  const events = milestones.data?.events ?? []
  const shown = showAll ? events : events.slice(0, 6)

  return (
    <Panel title="Upcoming milestones" description="Trial readouts, regulatory decisions and patent expiries ahead">
      {milestones.isPending && (
        <div className="space-y-2 p-5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}
      {milestones.data && events.length === 0 && <EmptyState title="No upcoming milestones" />}
      {shown.length > 0 && (
        <ul className="divide-y divide-[#eef0f3]">
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  const source = m.sources[0]
                  const tab = source && TAB_FOR_COLLECTION[source.collection]
                  if (source && tab) setOpen({ tab, key: source.record_key })
                }}
                className="flex w-full items-start gap-3 px-5 py-2.5 text-left hover:bg-accent/60"
              >
                <span className="w-[72px] shrink-0 font-mono text-xs leading-5 font-semibold text-primary">
                  {formatMonth(m.expected_date ?? m.date)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium">{m.title.replace(/^.*?expected: /, '')}</p>
                  <p className="text-muted-foreground">{detail(m)}</p>
                </div>
                <SignificanceBadge value={m.significance} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {events.length > 6 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full border-t border-[#eef0f3] px-5 py-2.5 text-left font-medium text-primary hover:bg-accent/60"
        >
          {showAll ? 'Show fewer' : `Show all ${events.length}`}
        </button>
      )}
      <RecordSheet assetId={assetId} tab={open?.tab ?? 'clinical'} recordKey={open?.key ?? null} onClose={() => setOpen(null)} />
    </Panel>
  )
}
