import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMarket, type EventCategory, type MarketImpact, type Significance } from '../api'
import { CATEGORY_META, CategoryIcon, SignificanceBadge } from '../components/badges'
import { TAB_FOR_COLLECTION } from '../api'
import { EmptyState, Panel } from '../components/panel'
import { RecordSheet } from '../components/record-sheet'
import { Segmented } from '../components/segmented'
import type { MeasuredEvent } from './market-chart'
import { useAssetContext } from './asset-layout'

/**
 * The asset company's share price with the move after each journey event (API /assets/:id/market, data from the
 * crawler's `market` step), filterable by the company's tracked drugs, event category, significance and range.
 * Moves show timing only, never that the event caused them.
 */

const MarketChart = lazy(() => import('./market-chart'))

type Range = '1y' | '5y' | 'all'
type Scope = 'key' | 'high'
type Order = 'newest' | 'largest'
const YEARS: Record<Range, number | null> = { '1y': 1, '5y': 5, all: null }
const SIGNIFICANCE: Record<Scope, Significance[]> = { key: ['High', 'Medium'], high: ['High'] }
const CATEGORIES = Object.keys(CATEGORY_META) as EventCategory[]
const ROWS_SHOWN = 25

export function rangeStart(range: Range, today = new Date()): string | null {
  const years = YEARS[range]
  if (years === null) return null
  const d = new Date(today)
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

/** The move that sums up the reaction: +5 trading days when measured, else day 0. */
export const headline = (i: MarketImpact) => i.day5 ?? i.day0

export function Pct({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn('text-muted-foreground', className)}>—</span>
  return (
    <span className={cn('tabular-nums', value > 0 ? 'text-success' : value < 0 ? 'text-destructive' : '', className)}>
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  )
}

function Chip({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-7 rounded-lg border px-2.5 font-medium text-text-secondary hover:bg-accent disabled:cursor-default',
        disabled && !active && 'opacity-50 hover:bg-transparent',
        active && 'border-primary bg-[#eef2fd] text-primary hover:bg-[#eef2fd]',
      )}
    >
      {children}
    </button>
  )
}

/** Selected event: what happened and how the price moved over the next 20 trading days. */
function EventCard({ e, onEvidence, onClose }: { e: MeasuredEvent; onEvidence: (() => void) | null; onClose: () => void }) {
  const m = e.impact
  const stat = (label: string, v: number | null, day?: number | null, none = '—') => (
    <div className="rounded-lg bg-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">
        {v === null ? <span className="text-muted-foreground">{none}</span> : <Pct value={v} />}
        {v !== null && day != null && <span className="ml-1 text-xs font-normal text-muted-foreground">day {day}</span>}
      </p>
    </div>
  )
  return (
    <div className="border-t border-[#eef0f3] px-5 py-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{e.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDate(e.date)} · {e.drug.name} · {CATEGORY_META[e.category]?.label ?? e.category}
            {m.trading_day !== e.date && ` · measured from ${formatDate(m.trading_day)}`}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          {onEvidence && (
            <button type="button" className="font-medium text-primary hover:underline" onClick={onEvidence}>
              Open evidence
            </button>
          )}
          <button type="button" className="font-medium text-text-secondary hover:underline" onClick={onClose}>
            Show full history
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stat('Event day', m.day0)}
        {stat('After 5 days', m.day5)}
        {stat('After 20 days', m.day20)}
        {stat('Deepest dip', m.dip, m.dip_day, 'no dip')}
        {stat('Highest peak', m.peak, m.peak_day, 'no rise')}
      </div>
    </div>
  )
}

export function MarketTab() {
  const asset = useAssetContext()
  const [range, setRange] = useState<Range>('5y')
  const [scope, setScope] = useState<Scope>('key')
  const [order, setOrder] = useState<Order>('newest')
  const [allRows, setAllRows] = useState(false)
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [extraDrugs, setExtraDrugs] = useState<string[]>([])
  const [hovered, setHovered] = useState<MeasuredEvent[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<MeasuredEvent | null>(null)
  const chartTop = useRef<HTMLDivElement>(null)
  const market = useMarket(asset.id, { drugs: extraDrugs, category: categories, significance: SIGNIFICANCE[scope] })
  const data = market.data

  const view = useMemo(() => {
    if (!data?.listed) return null
    const from = rangeStart(range) ?? ''
    const bars = data.bars.filter((b) => b.date >= from)
    const first = bars[0]?.date ?? ''
    const events = data.events.filter((e) => e.date >= from)
    const measured = events.filter((e): e is MeasuredEvent => !!e.impact && e.impact.trading_day >= first)
    const rows = [...events].sort((a, b) =>
      order === 'largest'
        ? Math.abs(b.impact ? headline(b.impact) : 0) - Math.abs(a.impact ? headline(a.impact) : 0)
        : b.date.localeCompare(a.date),
    )
    const change = bars.length > 1 ? (bars[bars.length - 1]!.close / bars[0]!.close - 1) * 100 : null
    return { bars, measured, rows, change }
  }, [data, range, order])

  const selected = view?.measured.find((e) => e.id === selectedId) ?? null
  const toggle = <T,>(set: (f: (cur: T[]) => T[]) => void, v: T) => set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
  const evidenceTab = (e: MeasuredEvent | null) => (e?.source ? TAB_FOR_COLLECTION[e.source.collection] : undefined)

  if (market.isPending) return <Skeleton className="h-96 w-full" />
  if (market.isError) return <p className="text-destructive">Share prices couldn't be loaded.</p>
  if (!data?.listed || !view) {
    return (
      <Panel title="Share price">
        <EmptyState title={`No listed share price for ${data?.company ?? asset.company.name}`}>
          The company is private, or its listing hasn't been collected yet (crawl step "Share prices of the listed company").
        </EmptyState>
      </Panel>
    )
  }

  const last = view.bars[view.bars.length - 1]
  const multiDrug = data.drugs.filter((d) => d.selected).length > 1
  // Events of one trading day share its move: say it once, then what happened.
  const hint = hovered ? (
    <>
      <span className="font-medium text-foreground">{formatDate(hovered[0]!.impact.trading_day)}</span>
      {' · '}
      <Pct value={headline(hovered[0]!.impact)} className="font-semibold" /> after 5 days{' · '}
      {hovered
        .slice(0, 3)
        .map((e) => `${e.title}${multiDrug ? ` (${e.drug.name})` : ''}`)
        .join(' · ')}
      {hovered.length > 3 && ` · +${hovered.length - 3} more`}
    </>
  ) : (
    'Hover a marker to see its event; click it (or a row below) to zoom in on the dip or rise. Zoom in for labels.'
  )

  return (
    <div ref={chartTop} className="flex scroll-mt-4 flex-col gap-5">
      <Panel
        title={`${data.listed_name ?? data.company} · ${data.ticker}`}
        description={[
          data.via_parent ? `Listed parent of ${data.company}` : null,
          data.exchange,
          last ? `${last.close.toFixed(2)} ${data.currency ?? ''} on ${formatDate(last.date)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Segmented
            label="Price range"
            value={range}
            onChange={(r) => {
              setRange(r)
              setSelectedId(null)
            }}
            options={[
              { value: '1y', label: '1Y' },
              { value: '5y', label: '5Y' },
              { value: 'all', label: 'All' },
            ]}
          />
        }
      >
        <div className="space-y-2 px-5 py-3">
          {data.drugs.length > 1 && (
            <div role="group" aria-label="Drugs" className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Drugs</span>
              {data.drugs.map((d) => (
                <Chip key={d.id} active={d.selected} disabled={d.id === asset.id} onClick={() => toggle(setExtraDrugs, d.id)}>
                  {d.name}
                </Chip>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Events</span>
            {CATEGORIES.map((c) => (
              <Chip key={c} active={categories.includes(c)} disabled={!data.category_counts[c] && !categories.includes(c)} onClick={() => toggle(setCategories, c)}>
                {CATEGORY_META[c].label}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{data.category_counts[c] ?? 0}</span>
              </Chip>
            ))}
            <div className="ml-auto">
              <Segmented
                label="Events shown"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'key', label: 'Key events' },
                  { value: 'high', label: 'High only' },
                ]}
              />
            </div>
          </div>
        </div>

        <p className="min-h-10 border-y border-[#eef0f3] bg-muted/40 px-5 py-2 text-sm text-text-secondary" aria-live="polite">
          {hint}
        </p>
        {view.bars.length === 0 ? (
          <EmptyState title="No prices in this range" />
        ) : (
          <div className={cn('px-2 pt-2', market.isFetching && 'opacity-60')}>
            <Suspense fallback={<Skeleton className="h-80 w-full" />}>
              <MarketChart
                bars={view.bars}
                events={view.measured}
                selected={selected}
                onSelect={(e) => setSelectedId(e.id)}
                onHover={setHovered}
              />
            </Suspense>
          </div>
        )}
        {selected && (
          <EventCard
            e={selected}
            onEvidence={evidenceTab(selected) ? () => setEvidence(selected) : null}
            onClose={() => setSelectedId(null)}
          />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#eef0f3] px-5 py-3 text-xs text-muted-foreground">
          <span><span className="text-success">▲</span> higher 5 trading days after the event</span>
          <span><span className="text-destructive">▼</span> lower (a dip)</span>
          <span>
            {data.note} Not investment advice. Prices: {data.source ?? 'unknown source'}
            {data.as_of ? `, as of ${formatDate(data.as_of)}` : ''}.
            {data.other_listings.length > 0 && ` Also linked: ${data.other_listings.join(', ')}.`}
          </span>
        </div>
      </Panel>

      <Panel
        title="Moves after each event"
        description={`${view.rows.length} events${view.change !== null ? ` · price ${view.change >= 0 ? '+' : ''}${view.change.toFixed(0)}% over the range` : ''}`}
        actions={
          <Segmented
            label="Order"
            value={order}
            onChange={setOrder}
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'largest', label: 'Largest move' },
            ]}
          />
        }
      >
        {view.rows.length === 0 ? (
          <EmptyState title="No events match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-[#eef0f3]">
                  <th className="px-5 py-2 font-medium">Event</th>
                  <th className="px-2 py-2 text-right font-medium">Day 0</th>
                  <th className="px-2 py-2 text-right font-medium">+5 days</th>
                  <th className="px-2 py-2 text-right font-medium">+20 days</th>
                  <th className="px-2 py-2 text-right font-medium">Dip</th>
                  <th className="px-5 py-2 text-right font-medium">Peak</th>
                </tr>
              </thead>
              <tbody>
                {(allRows ? view.rows : view.rows.slice(0, ROWS_SHOWN)).map((e) => {
                  const measurable = view.measured.some((m) => m.id === e.id)
                  return (
                    <tr key={e.id} className={cn('border-b border-[#eef0f3] last:border-0 hover:bg-accent/60', selectedId === e.id && 'bg-[#eef2fd]')}>
                      <td className="px-5 py-2">
                        <div className="flex items-start gap-3">
                          <CategoryIcon category={e.category} />
                          <div className="min-w-0">
                            {measurable ? (
                              <button
                                type="button"
                                className="text-left font-medium hover:underline"
                                onClick={() => {
                                  setSelectedId(e.id)
                                  chartTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                }}
                              >
                                {e.title}
                              </button>
                            ) : (
                              <span className="font-medium">{e.title}</span>
                            )}
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{formatDate(e.date)}</span>
                              <SignificanceBadge value={e.significance} />
                              {multiDrug && <span>{e.drug.name}</span>}
                              {e.note && <span>{e.note}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right"><Pct value={e.impact?.day0} /></td>
                      <td className="px-2 py-2 text-right font-semibold"><Pct value={e.impact?.day5} /></td>
                      <td className="px-2 py-2 text-right"><Pct value={e.impact?.day20} /></td>
                      <td className="px-2 py-2 text-right"><Pct value={e.impact?.dip} /></td>
                      <td className="px-5 py-2 text-right"><Pct value={e.impact?.peak} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {view.rows.length > ROWS_SHOWN && (
              <button
                type="button"
                className="w-full border-t border-[#eef0f3] px-5 py-3 text-left font-medium text-primary hover:bg-accent/60"
                onClick={() => setAllRows((v) => !v)}
              >
                {allRows ? 'Show fewer' : `Show all ${view.rows.length} events`}
              </button>
            )}
          </div>
        )}
      </Panel>

      {evidence?.source && evidenceTab(evidence) && (
        <RecordSheet assetId={evidence.drug.id} tab={evidenceTab(evidence)!} recordKey={evidence.source.record_key} onClose={() => setEvidence(null)} />
      )}
    </div>
  )
}
