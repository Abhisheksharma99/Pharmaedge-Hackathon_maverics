import { useState } from 'react'
import { formatDate } from '@/lib/format'
import type { CompetitorSignal } from '../../competitors-api'
import { CategoryIcon, SignificanceBadge } from '../badges'
import { EmptyState, Panel } from '../panel'
import { RecordSheet } from '../record-sheet'
import { humanize, sourceTarget } from './utils'

/** Competitors' latest high and medium significance events; each opens its source record. */
export function CompetitiveSignals({ signals }: { signals: CompetitorSignal[] }) {
  const [open, setOpen] = useState<ReturnType<typeof sourceTarget>>(null)

  return (
    <Panel title="Competitive signals" description="Latest high and medium significance moves from tracked competitors">
      {signals.length === 0 ? (
        <EmptyState title="No competitor signals yet">Signals appear as competitors' journeys are built.</EmptyState>
      ) : (
        <ol className="divide-y divide-[#eef0f3]">
          {signals.map((s) => {
            const target = sourceTarget(s.assetId, s.sources)
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!target}
                  onClick={() => setOpen(target)}
                  className="grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3 text-left enabled:hover:bg-accent/60"
                >
                  <CategoryIcon category={s.category} className="size-9 rounded-[10px]" />
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium">{s.title}</p>
                    <p className="mt-0.5 text-[12.5px] text-text-secondary">
                      {humanize(s.type)} · {s.assetName}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-mono text-[12px] whitespace-nowrap text-text-secondary">{formatDate(s.date)}</span>
                    <SignificanceBadge value={s.significance} />
                  </div>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {open && <RecordSheet assetId={open.assetId} tab={open.tab} recordKey={open.key} onClose={() => setOpen(null)} />}
    </Panel>
  )
}
