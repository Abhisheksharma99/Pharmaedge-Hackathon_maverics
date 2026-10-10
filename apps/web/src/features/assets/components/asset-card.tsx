import { Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { JourneyEventV3 } from '@/features/journey/types'
import { daysBetween, relativeFuture, todayIso } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AssetSummary } from '../api'
import { AssetTile } from './asset-tile'
import { KindBadge } from './badges'
import { shortIndication } from './competitors/utils'
import { Sparkline } from './sparkline'

const PILL = {
  building: 'bg-warning-soft text-warning',
  ok: 'bg-[#ecfdf3] text-[#067647]',
  failed: 'bg-danger-soft text-destructive',
}

function Pill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-full px-[10px] text-[12.5px] font-semibold whitespace-nowrap', PILL[tone])}>
      <i aria-hidden="true" className={cn('size-[6px] rounded-full', tone === 'building' ? 'animate-blink-dot bg-current' : tone === 'ok' ? 'bg-[#17b26a]' : 'bg-current')} />
      {children}
    </span>
  )
}

/** "Collecting · n%" while a crawl runs; otherwise Ready (Asset Search) or the approval regions (Home). */
export function AssetStatusPill({
  asset,
  progress,
  regions,
  variant,
}: {
  asset: Pick<AssetSummary, 'status'>
  progress: number | null
  regions?: string[]
  variant: 'home' | 'search'
}) {
  if (progress !== null) {
    const pct = Math.round(progress * 100)
    return <Pill tone="building">{variant === 'search' ? `Collecting · ${pct}%` : `${pct}%`}</Pill>
  }
  if (asset.status === 'onboarding') return <Pill tone="building">Collecting</Pill>
  if (asset.status === 'failed') return <Pill tone="failed">Collection failed</Pill>
  if (variant === 'home' && regions?.length) return <Pill tone="ok">{regions.join(', ')}</Pill>
  return <Pill tone="ok">Ready</Pill>
}

function Tag({ dashed = false, title, children }: { dashed?: boolean; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={cn(
        'rounded-[5px] px-[6px] py-px text-[11px] whitespace-nowrap',
        dashed ? 'border border-dashed bg-card text-muted-foreground' : 'bg-muted text-secondary-foreground',
      )}
    >
      {children}
    </span>
  )
}

/** Tracked-asset card (README §5.2 Home; §5.3 Asset Search grid with the kind badge). */
export function AssetCard({
  asset,
  events,
  progress,
  regions,
  competitors = 0,
  variant,
  index = 0,
}: {
  asset: AssetSummary
  /** Key events of this asset: sparkline and next milestone. */
  events: JourneyEventV3[]
  /** 0–1 while a crawl runs, else null. */
  progress: number | null
  /** Approved regions (Home), undefined while loading. */
  regions?: string[]
  /** Home footer: tracked competitors of this asset. */
  competitors?: number
  variant: 'home' | 'search'
  index?: number
}) {
  const today = todayIso()
  const brand = asset.aliases.find((a) => a.toLowerCase() !== asset.name.toLowerCase())
  const rivals = asset.competitorOf.map((p) => p.name)
  const next = events.filter((e) => e.is_milestone && daysBetween(today, e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0]

  return (
    <Link
      to={`/assets/${encodeURIComponent(asset.id)}/overview`}
      className="flex animate-fade-up flex-col gap-[12px] rounded-[14px] border bg-card p-[16px] text-left shadow-panel transition-[border-color,box-shadow,transform] motion-reduce:hover:translate-y-0 hover:-translate-y-[2px] hover:border-[#c4ccda] hover:shadow-card-hover"
      style={{ animationDelay: `${index * (variant === 'home' ? 70 : 50)}ms` }}
    >
      <span className="flex items-center gap-[10px]">
        <AssetTile name={asset.name} kind={asset.kind} size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-[6px]">
            <b className="text-[15px] font-semibold tracking-[-0.01em]">{asset.name}</b>
            {variant === 'search' && <KindBadge kind={asset.kind} competitorOf={rivals} />}
          </span>
          <span className="truncate text-[12px] text-muted-foreground">
            {variant === 'home' && brand ? `${brand} · ` : ''}
            {asset.company.name}
          </span>
        </span>
        <AssetStatusPill asset={asset} progress={progress} regions={regions} variant={variant} />
      </span>
      <span className="flex flex-wrap gap-[4px]">
        {(asset.tags.indications ?? []).map((x) => (
          <Tag key={x} title={x}>
            {shortIndication(x)}
          </Tag>
        ))}
        {(asset.tags.investigational_indications ?? []).map((x) => (
          <Tag key={`i-${x}`} dashed title={`${x} (investigational)`}>
            {shortIndication(x)}
          </Tag>
        ))}
        {variant === 'search' && asset.kind === 'competitor' && rivals.length > 0 && <Tag>vs {rivals.join(', ')}</Tag>}
      </span>
      <Sparkline events={events} thisYear={Number(today.slice(0, 4))} />
      {(variant !== 'home' || asset.latestEvent || progress !== null) && (
        <span className="flex min-w-0 gap-[8px] text-[12.5px] text-secondary-foreground">
          <span className="shrink-0 text-muted-foreground">Latest</span>
          <span className="truncate">{asset.latestEvent?.title ?? (progress !== null ? 'Collecting records…' : '—')}</span>
        </span>
      )}
      {variant === 'home' && (
        <span className="flex flex-wrap gap-x-[12px] gap-y-[4px] border-t border-hair pt-[10px] text-[12px] text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground">{formatNumber(asset.counts.events)}</b> events
          </span>
          <span>
            <b className="font-semibold text-foreground">{formatNumber(asset.counts.trials)}</b> trials
          </span>
          <span>
            <b className="font-semibold text-foreground">{competitors}</b> competitor{competitors === 1 ? '' : 's'}
          </span>
          {next && (
            <span className="ml-auto inline-flex items-center gap-[4px] font-semibold text-primary">
              <Clock className="size-[11px]" />
              {relativeFuture(next.date, today)}
            </span>
          )}
        </span>
      )}
    </Link>
  )
}
