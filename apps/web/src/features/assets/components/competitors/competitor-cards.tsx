import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { CardFilters, useCardFilter } from '@/components/card-filters'
import { cn } from '@/lib/utils'
import type { CompetitorsOverview, Coverage, LandscapeRow } from '../../competitors-api'
import { AssetTile } from '../asset-tile'
import { IndicationBadges } from '../badges'
import { shortIndication } from './utils'

const STAGE: Partial<Record<NonNullable<LandscapeRow['stage']>, { label: string; className: string }>> = {
  approved: { label: 'Approved', className: 'bg-success-soft text-success' },
  phase3: { label: 'Phase 3', className: 'bg-warning-soft text-warning' },
  phase2: { label: 'Phase 2', className: 'bg-muted text-secondary-foreground' },
}

const COVERAGE: Record<Coverage, { label: string; className: string }> = {
  approved: { label: 'Approved', className: 'border-transparent bg-success-soft text-success' },
  investigational: { label: 'Investigational', className: 'border-dashed border-warning text-warning' },
  none: { label: 'Not indicated', className: 'border-hair text-faint line-through' },
}

const BASIS = { both: 'indication and mechanism', indication: 'indication', mechanism: 'mechanism' } as const

/** Bordered card shared by the competitor cards (screen 24) and the "Competes with" cards (screen 26). */
export function AssetCard({
  index,
  tile,
  name,
  sub,
  tag,
  mechanism,
  children,
  note,
  to,
}: {
  index: number
  tile: ReactNode
  name: string
  sub: string
  tag?: ReactNode
  mechanism?: string | null
  children?: ReactNode
  note?: string
  to: string
}) {
  return (
    <div style={{ animationDelay: `${index * 60}ms` }} className="flex animate-fade-up flex-col gap-[10px] rounded-[12px] border p-[14px]">
      <div className="flex items-center gap-[10px]">
        {tile}
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="font-semibold">{name}</b>
          <span className="text-[12px] text-muted-foreground">{sub}</span>
        </div>
        {tag}
      </div>
      {mechanism && <p className="text-text-secondary">{mechanism}</p>}
      {children}
      <div className="flex items-center gap-[8px] border-t border-hair pt-[10px] text-[12px]">
        {note && <span className="text-muted-foreground">{note}</span>}
        <span className="flex-1" />
        <Button asChild variant="outline" size="sm">
          <Link to={to}>
            Open journey <ArrowRight className="size-[13px]" />
          </Link>
        </Button>
      </div>
    </div>
  )
}

export const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[14px] px-[20px] pt-[16px] pb-[20px]'

/** Every indication a competitor is in (short): the reference's ones it covers, plus its own other ones. */
export const competitorIndications = (r: LandscapeRow) => [
  ...new Set([...Object.entries(r.coverage).filter(([, c]) => c !== 'none').map(([x]) => shortIndication(x)), ...r.otherIndications.map(shortIndication)]),
]

/** The primary asset's ranked competitors, each with chip coverage of the primary's indications. */
export function CompetitorCards({ data }: { data: CompetitorsOverview }) {
  const indications = data.reference.indications
  const all = data.landscape.filter((r) => !r.isReference)
  const { filtered: rows, filters } = useCardFilter(
    all,
    (r) => [r.name, r.brand, r.company, r.mechanism, r.modality].filter(Boolean).join(' '),
    [
      { label: 'Indication', of: competitorIndications },
      { label: 'Stage', of: (r) => (r.stage ? [STAGE[r.stage]?.label ?? 'Other'] : []) },
      { label: 'Shared by', of: (r) => (r.basis ? [BASIS[r.basis]] : []) },
    ],
  )
  return (
    <>
      <CardFilters {...filters} collapseKey="asset.competitors" placeholder="Search competitors" />
      {rows.length === 0 && <p className="px-[20px] py-[24px] text-center text-text-secondary">No competitors match these filters.</p>}
      <div className={CARD_GRID}>
        {rows.map((r, i) => {
          const stage = r.stage ? STAGE[r.stage] : undefined
          return (
            <AssetCard
              key={r.id}
              index={i}
              tile={<AssetTile name={r.name} kind="competitor" size={34} />}
              name={r.name}
              sub={[r.brand, r.company].filter(Boolean).join(' · ')}
              tag={stage && <span className={cn('rounded-[5px] px-[6px] py-px text-[11px] whitespace-nowrap', stage.className)}>{stage.label}</span>}
              mechanism={r.mechanism}
              note={[r.basis && `Shared ${BASIS[r.basis]}`, r.overlap.of > 0 && `overlap ${r.overlap.shared} of ${r.overlap.of}`].filter(Boolean).join(' · ')}
              to={`/assets/${encodeURIComponent(r.id)}/overview`}
            >
              {indications.length > 0 && (
                <div className="flex flex-wrap gap-[4px]">
                  {indications.map((x) => {
                    const cov = COVERAGE[r.coverage[x] ?? 'none']
                    return (
                      <span key={x} title={`${x}: ${cov.label}`} className={cn('rounded-[6px] border px-[7px] py-[2px] text-[11.5px]', cov.className)}>
                        {shortIndication(x)}
                      </span>
                    )
                  })}
                </div>
              )}
              {r.otherIndications.length > 0 && (
                <div className="flex flex-wrap items-center gap-[6px] text-[12px] text-muted-foreground">
                  Also in <IndicationBadges items={r.otherIndications.map(shortIndication)} max={3} />
                </div>
              )}
            </AssetCard>
          )
        })}
      </div>
    </>
  )
}
