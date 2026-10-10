import { ArrowUpRight } from 'lucide-react'
import { MiniDonut } from '@/components/charts/mini-donut'
import type { RecordTab } from '@/features/assets/api'
import type { EventRecord } from '../api'
import { collectionMeta, TAB_LABEL } from '../constants'
import { FOCUS } from '../controls'
import { howBuilt } from '../journey-model'
import type { JourneyEventV3 } from '../types'
import { SheetSection } from './sheet-section'

const OPEN = `inline-flex items-center gap-[3px] rounded-sm whitespace-nowrap text-[12px] font-medium text-primary hover:underline ${FOCUS}`
const NOTE = 'mt-[8px] text-[12.5px] leading-normal text-text-secondary'

/** Evidence donut by collection + source list ("Open" → record sheet or the page) + how the event was built (README §6.4). */
export function Evidence({ event, records, onOpenRecord }: { event: JourneyEventV3; records: EventRecord[]; onOpenRecord: (r: { tab: RecordTab; key: string }) => void }) {
  const byColl = new Map<string, number>()
  for (const r of records) byColl.set(r.collection, (byColl.get(r.collection) ?? 0) + 1)
  const slices = [...byColl].map(([c, v]) => ({ l: collectionMeta(c).label, v, c: collectionMeta(c).color }))
  return (
    <SheetSection title="Evidence">
      {records.length ? (
        <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-[12px]">
          <MiniDonut data={slices} />
          <ul className="divide-y divide-hair overflow-hidden rounded-xl border">
            {records.map((r) => {
              const meta = collectionMeta(r.collection)
              return (
                <li key={`${r.collection}|${r.key}`} className="flex items-center gap-[10px] px-[12px] py-[10px]">
                  <span aria-hidden="true" className="size-[8px] shrink-0 rounded-full" style={{ background: meta.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12px]">{r.key}</p>
                    <p className="text-[11.5px] text-muted-foreground">{meta.tab ? `${meta.label} · ${TAB_LABEL[meta.tab]} tab` : meta.label}</p>
                  </div>
                  {r.tab ? (
                    <button type="button" aria-label={`Open ${r.title}`} onClick={() => onOpenRecord({ tab: r.tab as RecordTab, key: r.key })} className={OPEN}>
                      Open <ArrowUpRight className="size-[12px]" />
                    </button>
                  ) : (
                    r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.title}`} className={OPEN}>
                        Open <ArrowUpRight className="size-[12px]" />
                      </a>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className={NOTE}>
          {event.via === 'user'
            ? `Added manually by ${event.user?.by.name ?? 'a team member'}; no source records yet. It will be re-checked on the next refresh.`
            : 'No source records could be found for this event.'}
        </p>
      )}
      <p className={NOTE}>{howBuilt(event, records.length)}</p>
    </SheetSection>
  )
}
