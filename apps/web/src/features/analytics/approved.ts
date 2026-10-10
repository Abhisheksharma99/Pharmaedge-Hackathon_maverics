import { shortIndication } from '@/features/assets/components/competitors/utils'
import type { AssetAnalytics } from './api'

export interface ApprovedIndication {
  indication: string
  regions: string[]
}

const APPROVED_STAGE = 4

/**
 * The approved indications with their geographies. Uses the API's `stats.approved` when present; otherwise the
 * pipeline rows that reached Approved (not terminated), else the asset's own approved landscape cells, each with
 * the asset's approval regions as the geography.
 */
export function approvedIndications(data: Pick<AssetAnalytics, 'stats' | 'pipeline' | 'landscape'>, regions: string[]): ApprovedIndication[] {
  const given = data.stats.approved
  if (given?.length) return given
  const fromPipeline = data.pipeline.filter((r) => r.stage >= APPROVED_STAGE && !r.ended).map((r) => r.label)
  const mine = data.landscape.rows.find((r) => r.me)
  const fromLandscape = Object.entries(mine?.cells ?? {}).filter(([, v]) => v === 'approved').map(([k]) => shortIndication(k))
  const names = fromPipeline.length ? fromPipeline : fromLandscape
  return [...new Set(names)].map((indication) => ({ indication, regions }))
}
