import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { InlineError } from '@/components/inline-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssetDetails, useAssets } from '@/features/assets/api'
import { AssetCard } from '@/features/assets/components/asset-card'
import { EmptyState } from '@/features/assets/components/panel'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { eventsByAsset, usePortfolioTimeline } from '../api'

/** Home "Tracked assets" (README §5.2): one card per primary asset. */
export function TrackedAssets() {
  const assets = useAssets()
  const portfolio = usePortfolioTimeline()
  const running = runningByAsset(useJobs({ status: 'running' }).data)
  const all = assets.data ?? []
  const primary = all.filter((a) => a.kind === 'primary')
  const competitors = all.length - primary.length
  const details = useAssetDetails(primary.map((a) => a.id))
  const byAsset = eventsByAsset(portfolio.data?.events ?? [])

  return (
    <section aria-labelledby="tracked-assets-title" className="flex flex-col gap-[12px]">
      <div className="flex items-end justify-between gap-[16px]">
        <div>
          <h2 id="tracked-assets-title" className="text-[15px] font-semibold">
            Tracked assets
          </h2>
          {assets.data && (
            <p className="text-text-secondary">
              {primary.length} primary · {competitors} competitor{competitors === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/assets">
            Asset Search <ArrowRight />
          </Link>
        </Button>
      </div>
      {assets.isPending && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[16px]">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[230px] rounded-[14px]" />
          ))}
        </div>
      )}
      {assets.isError && <InlineError message="Assets couldn't be loaded." onRetry={() => void assets.refetch()} className="px-0" />}
      {assets.data && primary.length === 0 && (
        <div className="rounded-[14px] border bg-card">
          <EmptyState title="No assets yet">Add a drug by name with Asset AI.</EmptyState>
        </div>
      )}
      {primary.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-[16px]">
          {primary.map((a, i) => {
            const job = running.get(a.id)
            return (
              <AssetCard
                key={a.id}
                asset={a}
                variant="home"
                index={i}
                events={byAsset.get(a.id) ?? []}
                progress={job ? jobProgress(job) : null}
                regions={details[a.id]?.kpis.approvalRegions}
                competitors={all.filter((c) => c.competitorOf.some((p) => p.id === a.id)).length}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
