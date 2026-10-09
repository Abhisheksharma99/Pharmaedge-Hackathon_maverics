import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTimeline, type EventCategory, type JourneyEvent, type RecordTab, type Significance } from '../api'
import { CATEGORY_META, CategoryIcon, SignificanceBadge } from './badges'
import { EmptyState, Panel } from './panel'
import { RecordSheet } from './record-sheet'
import { Segmented } from './segmented'

/** Which asset tab shows an event's source record. */
export const TAB_FOR_COLLECTION: Record<string, RecordTab> = {
  fda_records: 'regulatory',
  ema_records: 'regulatory',
  trial_records: 'clinical',
  company_records: 'company-ir',
  articles: 'news',
  publication_records: 'publications',
  conference_records: 'conferences',
  patent_records: 'patents',
}

type Scope = 'key' | 'all'
const SIGNIFICANCE_FOR_SCOPE: Record<Scope, Significance[] | undefined> = { key: ['High', 'Medium'], all: undefined }
const CATEGORIES = Object.keys(CATEGORY_META) as EventCategory[]

function groupByYear(events: JourneyEvent[]): [string, JourneyEvent[]][] {
  const groups = new Map<string, JourneyEvent[]>()
  for (const e of events) {
    const year = e.date?.slice(0, 4) || 'Undated'
    groups.set(year, [...(groups.get(year) ?? []), e])
  }
  return [...groups.entries()]
}

export function JourneyTimeline({ assetId }: { assetId: string }) {
  const [scope, setScope] = useState<Scope>('key')
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [companyOnly, setCompanyOnly] = useState(true)
  const [open, setOpen] = useState<{ tab: RecordTab; key: string } | null>(null)

  const timeline = useTimeline(assetId, {
    milestones: 'exclude',
    significance: SIGNIFICANCE_FOR_SCOPE[scope],
    category: categories,
    companyOnly,
  })

  const toggleCategory = (c: EventCategory) =>
    setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))

  const openEvent = (e: JourneyEvent) => {
    const source = e.sources[0]
    const tab = source && TAB_FOR_COLLECTION[source.collection]
    if (source && tab) setOpen({ tab, key: source.record_key })
  }

  return (
    <Panel
      title="Journey"
      description="Dated events from regulatory, clinical and company sources. Select an event to see its evidence."
      actions={
        <Segmented
          label="Events shown"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'key', label: 'Key events' },
            { value: 'all', label: 'All' },
          ]}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        {CATEGORIES.map((c) => {
          const active = categories.includes(c)
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              onClick={() => toggleCategory(c)}
              className={cn(
                'h-7 rounded-lg border px-2.5 font-medium text-text-secondary hover:bg-accent',
                active && 'border-primary bg-[#eef2fd] text-primary hover:bg-[#eef2fd]',
              )}
            >
              {CATEGORY_META[c].label}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          <Switch id="company-only" checked={companyOnly} onCheckedChange={setCompanyOnly} />
          <Label htmlFor="company-only" className="font-normal text-text-secondary">
            Company-sponsored trials only
          </Label>
        </div>
      </div>

      {timeline.isPending && (
        <div className="space-y-3 px-5 pb-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {timeline.isError && <p className="px-5 pb-5 text-destructive">The journey couldn't be loaded.</p>}
      {timeline.data?.events.length === 0 && <EmptyState title="No events match these filters" />}

      {timeline.data && timeline.data.events.length > 0 && (
        <ol className={cn('px-5 pb-5', timeline.isFetching && 'opacity-60')}>
          {groupByYear(timeline.data.events).map(([year, events]) => (
            <li key={year} className="mt-4 first:mt-1">
              <p className="mb-2 font-mono text-xs font-semibold text-muted-foreground">{year}</p>
              <ul className="space-y-1">
                {events.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => openEvent(e)}
                      className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent/60"
                    >
                      <CategoryIcon category={e.category} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{e.title}</span>
                          {e.region && (
                            <span className="rounded bg-muted px-1.5 text-xs font-medium text-secondary-foreground">{e.region}</span>
                          )}
                        </div>
                        {e.summary && <p className="mt-0.5 line-clamp-1 text-text-secondary">{e.summary}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-mono text-xs text-muted-foreground">{formatDate(e.date)}</span>
                        <SignificanceBadge value={e.significance} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {timeline.data && timeline.data.total > timeline.data.events.length && (
        <p className="border-t border-[#eef0f3] px-5 py-3 text-muted-foreground">
          Showing the latest {timeline.data.events.length} of {timeline.data.total} events.
        </p>
      )}

      {open && <RecordSheet assetId={assetId} tab={open.tab} recordKey={open.key} onClose={() => setOpen(null)} />}
    </Panel>
  )
}
