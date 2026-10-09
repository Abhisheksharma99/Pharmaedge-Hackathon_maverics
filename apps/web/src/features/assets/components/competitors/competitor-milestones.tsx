import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMonth, formatPhase } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CompetitorMilestone } from '../../competitors-api'
import { SignificanceBadge } from '../badges'
import { EmptyState, Panel } from '../panel'
import { Pager } from '../pager'
import { RecordSheet } from '../record-sheet'
import { AssetAvatar } from './asset-avatar'
import { humanize, MILESTONE_GROUPS, milestoneGroup, sourceTarget, type MilestoneGroup } from './utils'

const PAGE_SIZE = 10
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const GROUPS = Object.keys(MILESTONE_GROUPS) as MilestoneGroup[]

type Filter = 'all' | MilestoneGroup

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + (Number(iso.slice(5, 7)) || 1) - 1
const monthLabel = (i: number, withYear: boolean) => `${MONTHS[i % 12]}${withYear ? ` ’${String(Math.floor(i / 12)).slice(2)}` : ''}`
/** Rule titles read "Phase 3 primary completion expected: TETON-2"; the event column already says what it is. */
const detail = (m: CompetitorMilestone) => m.title.replace(/^.*?expected: /, '')

function eventLabel(m: CompetitorMilestone, group: MilestoneGroup): string {
  if (group === 'readout') return m.phase && m.phase !== 'NA' ? `${formatPhase(m.phase)} readout` : 'Trial readout'
  if (group === 'other') return humanize(m.type)
  return MILESTONE_GROUPS[group].chip
}

function Mark({ group, className }: { group: MilestoneGroup; className?: string }) {
  return <span aria-hidden="true" className={cn('size-[8px] shrink-0', MILESTONE_GROUPS[group].mark, className)} />
}

/** Month axis with a marker per milestone (stacked when several fall in one month). The table below lists them all. */
function MilestoneAxis({ milestones }: { milestones: CompetitorMilestone[] }) {
  const dated = milestones.filter((m) => /^\d{4}/.test(m.date))
  if (!dated.length) return null
  const indexes = dated.map((m) => monthIndex(m.date))
  const from = Math.min(...indexes)
  const to = Math.max(from + 5, ...indexes)
  const step = Math.ceil((to - from + 1) / 12)
  const left = (i: number) => `${((i - from) / (to - from)) * 100}%`
  const byMonth = new Map<number, CompetitorMilestone[]>()
  dated.forEach((m, k) => byMonth.set(indexes[k], [...(byMonth.get(indexes[k]) ?? []), m]))
  const ticks = Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, k) => from + k * step)

  return (
    <div aria-hidden="true" className="overflow-x-auto border-t border-[#eef0f3] bg-[#fcfcfd] px-7 pt-1.5 pb-3.5">
      <div className="flex min-w-[560px] justify-between gap-3 py-1 text-[12px] text-muted-foreground">
        <span>Milestones listed below</span>
        <span className="font-mono">
          {MONTHS[from % 12]} {Math.floor(from / 12)} – {MONTHS[to % 12]} {Math.floor(to / 12)}
        </span>
      </div>
      <div className="relative h-[80px] min-w-[560px]">
        <div className="absolute inset-x-0 top-[50px] h-[2px] rounded-[1px] bg-border" />
        {ticks.map((i) => (
          <span key={i} className="absolute top-[62px] -translate-x-1/2 text-[12px] whitespace-nowrap text-muted-foreground" style={{ left: left(i) }}>
            {monthLabel(i, i === from || Math.floor(i / 12) !== Math.floor((i - step) / 12))}
          </span>
        ))}
        {[...byMonth].map(([i, items]) => (
          <div key={i} className="absolute" style={{ left: left(i) }}>
            {items.slice(0, 3).map((m, k) => {
              const g = milestoneGroup(m)
              return (
                <span
                  key={m.id}
                  title={`${m.assetName}: ${detail(m)} (${formatMonth(m.date)})`}
                  className={cn('absolute -ml-[5.5px] size-[11px] shadow-[0_0_0_3px_#fcfcfd]', MILESTONE_GROUPS[g].mark)}
                  style={{ top: 46 - k * 15 }}
                />
              )
            })}
            {items.length > 3 && (
              <span className="absolute top-0 -translate-x-1/2 text-[11px] font-semibold text-text-secondary">+{items.length - 3}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Competitors' forward-looking milestones, filterable by kind, each opening its source record. */
export function CompetitorMilestones({ milestones }: { milestones: CompetitorMilestone[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<ReturnType<typeof sourceTarget>>(null)

  const counts = new Map<MilestoneGroup, number>()
  for (const m of milestones) counts.set(milestoneGroup(m), (counts.get(milestoneGroup(m)) ?? 0) + 1)
  const shown = filter === 'all' ? milestones : milestones.filter((m) => milestoneGroup(m) === filter)
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const chips: { value: Filter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: milestones.length },
    ...GROUPS.map((g) => ({ value: g, label: MILESTONE_GROUPS[g].label, count: counts.get(g) ?? 0 })),
  ]
  const pick = (f: Filter) => {
    setFilter(f)
    setPage(1)
  }
  const head = 'h-9 text-[12px] font-semibold text-text-secondary'

  return (
    <Panel title="Upcoming competitor milestones" description="Trial readouts, regulatory decisions and patent expiries over the next 24 months">
      {milestones.length === 0 ? (
        <EmptyState title="No upcoming competitor milestones">Expected readouts and decisions appear as competitors' journeys are built.</EmptyState>
      ) : (
        <>
          <div role="group" aria-label="Filter milestones by type" className="flex flex-wrap gap-2 px-5 py-3.5">
            {chips
              .filter((c) => c.count > 0)
              .map((c) => {
                const active = c.value === filter
                return (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pick(c.value)}
                    className={cn(
                      'inline-flex h-[34px] items-center gap-2 rounded-full border border-input bg-card pr-1.5 pl-3 font-medium text-secondary-foreground hover:bg-accent',
                      active && 'border-primary bg-primary text-primary-foreground hover:bg-primary',
                    )}
                  >
                    {c.value !== 'all' && <Mark group={c.value} className={cn(active && 'bg-primary-foreground')} />}
                    {c.label}
                    <span
                      className={cn(
                        'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-semibold',
                        active ? 'bg-card text-primary' : 'bg-muted text-text-secondary',
                      )}
                    >
                      {c.count}
                    </span>
                  </button>
                )
              })}
          </div>
          <MilestoneAxis milestones={shown} />
          <Table className="min-w-[760px] border-t border-[#eef0f3] text-[13px]">
            <TableHeader>
              <TableRow className="bg-background hover:bg-background">
                <TableHead className={cn(head, 'pl-5')}>Date</TableHead>
                <TableHead className={head}>Asset</TableHead>
                <TableHead className={head}>Event</TableHead>
                <TableHead className={head}>Details · indication</TableHead>
                <TableHead className={cn(head, 'pr-5')}>Impact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((m) => {
                const group = milestoneGroup(m)
                const target = sourceTarget(m.assetId, m.sources)
                return (
                  <TableRow
                    key={m.id}
                    tabIndex={target ? 0 : undefined}
                    onClick={() => target && setOpen(target)}
                    onKeyDown={(e) => e.key === 'Enter' && target && setOpen(target)}
                    className={cn('border-[#eef0f3]', target && 'cursor-pointer')}
                  >
                    <TableCell className="py-2.5 pl-5 font-mono text-[12.5px] text-secondary-foreground">{formatMonth(m.date)}</TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-2.5">
                        <AssetAvatar id={m.assetId} name={m.assetName} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold">{m.assetName}</p>
                          <p className="text-[12px] text-text-secondary">{m.company}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className={cn('inline-flex h-6 items-center gap-2 rounded-md px-2 text-[12.5px] font-medium', MILESTONE_GROUPS[group].event)}>
                        <Mark group={group} />
                        {eventLabel(m, group)}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-[200px] py-2.5 whitespace-normal">
                      <p className="text-secondary-foreground">{detail(m)}</p>
                      {m.indication && <p className="text-[12px] text-text-secondary">{m.indication}</p>}
                    </TableCell>
                    <TableCell className="py-2.5 pr-5">
                      <SignificanceBadge value={m.significance} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} />
        </>
      )}
      {open && <RecordSheet assetId={open.assetId} tab={open.tab} recordKey={open.key} onClose={() => setOpen(null)} />}
    </Panel>
  )
}
