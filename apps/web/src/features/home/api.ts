import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { JourneyEventV3 } from '@/features/journey/types'

/** An asset row of the Home portfolio timeline (GET /portfolio/timeline). */
export interface PortfolioAsset {
  id: string
  name: string
  kind: 'primary' | 'competitor'
  company: string | null
  status: 'onboarding' | 'ready' | 'failed'
  /** Share of done steps of a running job, cached 60 s server-side; the UI uses the live job instead. */
  progress: number | null
  /** Primary asset ids a competitor is tracked against. */
  competitorOf: string[]
}

export interface PortfolioTimeline {
  assets: PortfolioAsset[]
  /** Key events of those assets (spec §4.1), oldest first. */
  events: JourneyEventV3[]
}

/**
 * Every tracked asset (competitors included) with its key events. One request feeds the whole Home dashboard
 * and the Asset Search sparklines; each block filters it. `live` refetches every 10 s while a crawl runs.
 */
export function usePortfolioTimeline({ live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ['portfolio', 'timeline', { competitors: true }],
    queryFn: async () => {
      const data = await apiFetch<PortfolioTimeline>('/portfolio/timeline?competitors=true')
      // Until stored events are migrated, the API can still send the retired 'safety' category: it is clinical.
      return { ...data, events: data.events.map((e) => ((e.category as string) === 'safety' ? { ...e, category: 'clinical' as const } : e)) }
    },
    refetchInterval: live ? 10_000 : false,
  })
}

/** Events grouped by asset id, keeping their order. */
export function eventsByAsset<T extends { asset: string }>(events: T[]): Map<string, T[]> {
  const byAsset = new Map<string, T[]>()
  for (const e of events) {
    const list = byAsset.get(e.asset)
    if (list) list.push(e)
    else byAsset.set(e.asset, [e])
  }
  return byAsset
}
