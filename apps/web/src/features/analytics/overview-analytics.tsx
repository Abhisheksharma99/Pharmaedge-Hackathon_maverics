import { Plus, Sparkle, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { ChartCard, ChartGrid } from '@/components/charts/chart-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { AssetSummary } from '@/features/assets/api'
import type { AnalyticsPin, AnalyticsSpec } from '@/features/journey/types'
import { FOCUS } from '@/features/journey/controls'
import { cn } from '@/lib/utils'
import { AddAnalyticsDialog } from './add-analytics-dialog'
import { useAnalyticsPins, useAssetAnalytics, useSavePins } from './api'
import { SpecChart } from './spec-chart'
import { OV_TEMPLATES, defaultKeys } from './templates'

const SPEC_WIDE = new Set(['list', 'stack', 'hbar'])

function RemoveButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-[26px] shrink-0 rounded-[8px] text-text-secondary"
      aria-label={`Remove ${title}`}
      onClick={onClick}
    >
      <X size={13} aria-hidden="true" />
    </Button>
  )
}

function CustomCard({ spec, onRemove }: { spec: AnalyticsSpec; onRemove: () => void }) {
  return (
    <ChartCard
      title={spec.title}
      span={SPEC_WIDE.has(spec.chart) ? 2 : 1}
      description={spec.method === 'web' ? 'Asset AI · public web sources' : 'Asset AI · indexed data'}
      actions={<RemoveButton title={spec.title} onClick={onRemove} />}
    >
      <SpecChart spec={spec} />
      {spec.note && (
        <p className="mt-[8px] mb-0 flex items-start gap-[6px] text-[12px] text-warning">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          {spec.note}
        </p>
      )}
      <details className="mt-[8px] text-[11.5px]">
        <summary className={cn('inline-flex cursor-pointer list-none items-center gap-[4px] rounded-sm font-semibold text-violet', FOCUS)}>
          <Sparkle size={11} aria-hidden="true" />
          {spec.sources.length} source{spec.sources.length === 1 ? '' : 's'}
        </summary>
        {spec.sources.map((s) => (
          <span key={s} className="mt-[4px] block font-mono break-words text-muted-foreground">
            {s}
          </span>
        ))}
      </details>
    </ChartCard>
  )
}

/** The Overview's pinned analytics (README §7.3): your cards, Reset, and the Add analytics dialog. */
export function OverviewAnalytics({ asset }: { asset: Pick<AssetSummary, 'id' | 'name'> }) {
  const blocks = useAssetAnalytics(asset.id)
  const pins = useAnalyticsPins(asset.id)
  const save = useSavePins(asset.id)
  const [open, setOpen] = useState(false)

  const ready = !blocks.isPending && !pins.isPending
  const defaults: AnalyticsPin[] = defaultKeys(blocks.data).map((key) => ({
    key,
  }))
  const items = pins.data?.items ?? defaults
  const pinned = items.flatMap((i) => (i.key ? [i.key] : []))
  const add = (pin: AnalyticsPin) => {
    if (pin.custom && items.some((i) => i.custom?.id === pin.custom!.id)) return
    save.mutate([...items, pin])
  }
  const remove = (i: number) => save.mutate(items.filter((_, j) => j !== i))

  return (
    <section aria-label="Pinned analytics" className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-end justify-between gap-[10px]">
        <div>
          <h3 className="m-0 text-[15px] font-semibold">Analytics</h3>
          <p className="mt-[2px] mb-0 text-text-secondary">
            Pinned for {asset.name}. Add your own from indexed data, or ask Asset AI to build one.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button variant="outline" size="sm" className="h-[32px] gap-[8px] rounded-[8px] px-[12px] text-[13px]" onClick={() => save.mutate(defaults)}>
            Reset
          </Button>
          <Button size="sm" className="h-[32px] gap-[8px] rounded-[8px] px-[12px] text-[13px]" onClick={() => setOpen(true)}>
            <Plus size={14} aria-hidden="true" />
            Add analytics
          </Button>
        </div>
      </div>
      <ChartGrid>
        {!ready && (
          <div role="status" aria-label="Loading analytics" className="contents">
            <Skeleton className="h-40 rounded-[14px] min-[701px]:col-span-2" />
            <Skeleton className="h-40 rounded-[14px]" />
          </div>
        )}
        {ready && blocks.isError && (
          <p role="alert" className="col-span-full m-0 flex flex-wrap items-center gap-[6px] text-warning">
            <TriangleAlert size={14} aria-hidden="true" />
            Analytics couldn’t be loaded.
            <Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={() => void blocks.refetch()}>
              Try again
            </Button>
          </p>
        )}
        {ready &&
          items.map((it, i) => {
            if (it.custom) {
              // Values never show without their sources; the same spec pinned twice shows once.
              const first = items.findIndex((x) => x.custom?.id === it.custom!.id) === i
              return it.custom.sources.length && first ? (
                <CustomCard key={`c:${it.custom.id}`} spec={it.custom} onRemove={() => remove(i)} />
              ) : null
            }
            const t = it.key ? OV_TEMPLATES[it.key] : undefined
            if (!t || !blocks.data || !t.requires(blocks.data)) return null
            return (
              <ChartCard
                key={it.key}
                title={t.title}
                description={t.description}
                span={t.span}
                actions={<RemoveButton title={t.title} onClick={() => remove(i)} />}
              >
                {t.render(blocks.data)}
              </ChartCard>
            )
          })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn('flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-[4px] rounded-[14px] border-[1.5px] border-dashed border-input bg-transparent text-text-secondary transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary', FOCUS)}
        >
          <Plus size={18} aria-hidden="true" />
          <b className="font-semibold">Add analytics</b>
          <span className="text-[12px] text-muted-foreground">From indexed data, or ask Asset AI</span>
        </button>
      </ChartGrid>
      {open && <AddAnalyticsDialog assetId={asset.id} pinned={pinned} onAdd={add} onClose={() => setOpen(false)} />}
    </section>
  )
}
