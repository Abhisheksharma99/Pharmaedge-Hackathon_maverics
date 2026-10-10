import { Skeleton } from '@/components/ui/skeleton'
import { useAssetDetails, type AssetDetail } from '../api'
import { useCompetitors } from '../competitors-api'
import { AssetTile } from '../components/asset-tile'
import { AssetCard, CARD_GRID, CompetitorCards } from '../components/competitors/competitor-cards'
import { IdentifyCompetitors } from '../components/competitors/identify-competitors'
import { LoadError } from '../components/competitors/load-error'
import { EmptyState, Panel } from '../components/panel'
import { useAssetContext } from './asset-layout'

/** Card-grid placeholder matching the competitor cards (same grid, ~170px cards). */
function Loading() {
  return (
    <Panel title="Competitors" description="Ranked by shared indication and mechanism. Each is crawled lightly and has its own journey.">
      <div role="status" aria-label="Loading competitors" className={CARD_GRID}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[170px] rounded-[12px]" />
        ))}
      </div>
    </Panel>
  )
}

function PrimaryCompetitors({ asset }: { asset: AssetDetail }) {
  const competitors = useCompetitors(asset.id)
  const data = competitors.data

  if (!data) {
    return competitors.isError ? (
      <LoadError message="The competitive landscape couldn't be loaded." onRetry={() => competitors.refetch()} />
    ) : (
      <Loading />
    )
  }
  if (data.kpis.tracked === 0 && data.landscape.every((r) => r.isReference)) return <IdentifyCompetitors asset={asset} />

  return (
    <Panel title="Competitors" description="Ranked by shared indication and mechanism. Each is crawled lightly and has its own journey.">
      <CompetitorCards data={data} />
    </Panel>
  )
}

/** Competitor assets don't get their own landscape: a "Competes with" grid of the primaries they are tracked against (screen 26). */
function CompetitorNote({ asset }: { asset: AssetDetail }) {
  const primaries = asset.competitorOf ?? []
  const details = useAssetDetails(primaries.map((p) => p.id))
  return (
    <Panel title="Competes with" description="Primary assets this competitor is tracked against.">
      {primaries.length === 0 ? (
        <EmptyState title="Competitors are tracked for primary assets" />
      ) : (
        <div className={CARD_GRID}>
          {primaries.map((p, i) => {
            const d = details[p.id]
            const brand = d?.aliases.filter((x) => x.toLowerCase() !== p.name.toLowerCase()).join(' · ')
            return (
              <AssetCard
                key={p.id}
                index={i}
                tile={<AssetTile name={p.name} kind="primary" size={34} />}
                name={p.name}
                sub={[brand, d?.company.name].filter(Boolean).join(' · ')}
                mechanism={d?.tags.mechanism}
                to={`/assets/${encodeURIComponent(p.id)}/overview`}
              />
            )
          })}
        </div>
      )}
    </Panel>
  )
}

export function CompetitorsTab() {
  const asset = useAssetContext()
  return asset.kind === 'competitor' ? <CompetitorNote asset={asset} /> : <PrimaryCompetitors asset={asset} />
}
