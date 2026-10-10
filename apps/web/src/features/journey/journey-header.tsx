import { Activity, Columns2, Flag, Plus, Rows2, Star } from 'lucide-react'
import { useMemo, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/features/assets/components/segmented'
import { cn } from '@/lib/utils'
import type { JourneyScope } from './api'
import { BTN_SM, CHIP, CHIP_ON, FOCUS } from './controls'
import { CATEGORIES, CATEGORY_META } from './constants'
import { laneOf, type BranchModel, type JourneyView, type Mine } from './journey-model'
import type { EventCategory, JourneyEventV3 } from './types'


export interface JourneyHeaderProps {
  model: BranchModel
  /** The events the view shows (after filters). */
  list: JourneyEventV3[]
  undated: number
  counts: { cats: Record<EventCategory, number>; starred: number; notes: number }
  view: JourneyView
  scope: JourneyScope
  cats: EventCategory[]
  mine: Mine | null
  focusBranch: string | null
  onView: (v: JourneyView) => void
  onScope: (s: JourneyScope) => void
  onToggleCat: (c: EventCategory) => void
  onMine: (m: Mine | null) => void
  onFocusBranch: (id: string | null) => void
  onClear: () => void
  onAdd: () => void
}

/** Journey header card (README §6.2 "Header", SCREENS 7): title, counts, actions, branch cards and filter chips. */
export function JourneyHeader(p: JourneyHeaderProps) {
  const { model, list } = p
  const span = list.length ? `${list[0]!.date.slice(0, 4)}–${list[list.length - 1]!.date.slice(0, 4)}` : ''
  const perLane = useMemo(() => {
    const m = new Map<string, JourneyEventV3[]>()
    for (const e of list) {
      const id = laneOf(e, model)
      const mine = m.get(id)
      if (mine) mine.push(e)
      else m.set(id, [e])
    }
    return m
  }, [list, model])
  const laneCount = model.list.filter((b) => perLane.has(b.id)).length
  return (
    <section aria-label="Journey" className="flex flex-wrap items-start justify-between gap-x-[24px] gap-y-[12px] rounded-[14px] border bg-card px-[20px] py-[18px] shadow-panel">
      <div className="min-w-0">
        <h3 className="text-[15px] leading-5 font-semibold">Journey</h3>
        <p className="mt-[2px] text-pretty text-text-secondary">
          {list.length} event{list.length === 1 ? '' : 's'}
          {span && `, ${span}`}
          {model.multi && ` · ${laneCount} indication branch${laneCount === 1 ? '' : 'es'}`}.{' '}
          {model.multi ? 'Each new indication forks off the programme that led to it; select a branch to focus it.' : 'Open a card’s subtree for its evidence and linked events.'}
          {p.undated > 0 && ` ${p.undated} undated event${p.undated === 1 ? ' is' : 's are'} not placed on the timeline.`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button asChild variant="ghost" size="sm" className={cn(BTN_SM, 'text-primary hover:bg-primary-soft hover:text-primary dark:hover:bg-primary-soft')}>
          <Link to="?build=1">
            <Activity /> How this journey was built
          </Link>
        </Button>
        <Segmented
          variant="compact"
          label="Orientation"
          value={p.view}
          onChange={p.onView}
          options={[
            { value: 'v', label: 'Tree', icon: Rows2 },
            { value: 'h', label: 'Horizontal', icon: Columns2 },
          ]}
        />
        <Segmented variant="compact" label="Events shown" value={p.scope} onChange={p.onScope} options={[{ value: 'key', label: 'Key events' }, { value: 'all', label: 'All' }]} />
        <Button size="sm" className={BTN_SM} onClick={p.onAdd}>
          <Plus /> Add to timeline
        </Button>
      </div>
      {model.multi && (
        <div className="grid basis-full grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-[8px]">
          {model.list.map((b) => {
            const mine = perLane.get(b.id) ?? []
            const on = p.focusBranch === b.id
            const parent = b.from ? model.byId.get(b.from)?.label : undefined
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                disabled={!mine.length}
                onClick={() => p.onFocusBranch(on ? null : b.id)}
                className={cn(
                  'flex flex-col gap-[2px] rounded-xl border bg-card px-[12px] py-[10px] text-left transition-[border-color,box-shadow,opacity] hover:border-[var(--lc)]',
                  FOCUS,
                  on && 'border-[var(--lc)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--lc)_16%,transparent)]',
                  p.focusBranch && !on && 'opacity-50',
                  !mine.length && 'cursor-default opacity-40 hover:border-border',
                )}
                style={{ '--lc': b.color } as CSSProperties}
              >
                <span className="flex items-center gap-[6px]">
                  <i aria-hidden="true" className="size-[8px] rounded-full" style={{ background: b.color }} />
                  <b className="font-[650]" style={{ color: b.color }}>
                    {b.label}
                  </b>
                  <span className="text-[11px] text-muted-foreground">{b.trunk ? 'Trunk' : parent ? `from ${parent}` : ''}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">{mine.length}</span>
                </span>
                <span className="text-[12px] text-secondary-foreground">{b.full}</span>
                <span className={cn('text-[11.5px] text-muted-foreground', b.ended && 'text-warning')}>
                  {b.status}
                  {mine[0] && ` · since ${mine[0].date.slice(0, 4)}`}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div role="group" aria-label="Filter the journey" className="flex basis-full flex-wrap items-center gap-[8px]">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" aria-pressed={p.cats.includes(c)} onClick={() => p.onToggleCat(c)} className={cn(CHIP, p.cats.includes(c) && CHIP_ON)}>
            <i aria-hidden="true" className="size-[7px] rounded-full" style={{ background: CATEGORY_META[c].color }} />
            {CATEGORY_META[c].label}
            <span className="font-mono text-[11px] text-muted-foreground">{p.counts.cats[c]}</span>
          </button>
        ))}
        <span aria-hidden="true" className="mx-[4px] h-[20px] w-px bg-border" />
        <button type="button" aria-pressed={p.mine === 'starred'} onClick={() => p.onMine(p.mine === 'starred' ? null : 'starred')} className={cn(CHIP, p.mine === 'starred' && CHIP_ON)}>
          <Star className="size-[12px]" aria-hidden="true" />
          Starred
          <span className="font-mono text-[11px] text-muted-foreground">{p.counts.starred}</span>
        </button>
        <button type="button" aria-pressed={p.mine === 'notes'} onClick={() => p.onMine(p.mine === 'notes' ? null : 'notes')} className={cn(CHIP, p.mine === 'notes' && CHIP_ON)}>
          <Flag className="size-[12px]" aria-hidden="true" />
          Team notes
          <span className="font-mono text-[11px] text-muted-foreground">{p.counts.notes}</span>
        </button>
        {(p.cats.length > 0 || p.focusBranch || p.mine) && (
          <button type="button" onClick={p.onClear} className={cn('rounded-sm px-[4px] text-[12.5px] font-medium text-primary hover:underline', FOCUS)}>
            Clear
          </button>
        )}
      </div>
    </section>
  )
}
