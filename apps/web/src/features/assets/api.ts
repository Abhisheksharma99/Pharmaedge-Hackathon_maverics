import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

export type Significance = 'High' | 'Medium' | 'Low'
export type EventCategory = 'regulatory' | 'clinical' | 'safety' | 'company' | 'ip'

export interface AssetSummary {
  id: string
  name: string
  aliases: string[]
  company: { name: string; website?: string; ir_url?: string }
  tags: {
    indications?: string[]
    investigational_indications?: string[]
    mechanism?: string
    modality?: string
    routes?: string[]
  }
  kind: 'primary' | 'competitor'
  status: 'onboarding' | 'ready' | 'failed'
  updatedAt: string | null
  counts: {
    trials: number
    regulatory: number
    pressReleases: number
    documents: number
    news: number
    publications: number
    conferences: number
    patents: number
    events: number
  }
  latestEvent: { date: string; title: string; type: string } | null
  /** Competitor assets: the primary assets they compete with. */
  competitorOf: { id: string; name: string }[]
}

/** A ranked competitor of a primary asset, as stored by the crawl service. */
export interface AssetCompetitor {
  id: string
  name: string
  company: string
  reason: string
  basis: 'indication' | 'mechanism' | 'both'
  stage: 'approved' | 'phase3' | 'phase2' | 'other'
  coverage: Record<string, 'approved' | 'investigational' | 'none'>
  other_indications: string[]
}

export interface AssetDetail extends AssetSummary {
  kpis: { approvalRegions: string[]; activeTrials: number; activePhase3: number; upcomingMilestones: number }
  competitors: AssetCompetitor[]
  suggestedQuestions: string[]
}

export interface JourneyEvent {
  id: string
  asset: string
  date: string
  type: string
  category: EventCategory
  title: string
  summary?: string
  significance: Significance
  is_milestone: boolean
  expected_date?: string
  region?: string
  phase?: string | null
  nct_id?: string
  sponsor?: string
  sponsor_is_company?: boolean
  sources: { collection: string; record_key: string }[]
}

export interface TimelineFilters {
  category?: EventCategory[]
  significance?: Significance[]
  milestones?: 'only' | 'exclude'
  companyOnly?: boolean
  limit?: number
}

/** A record from any source collection; fields vary by source (spec §3.2). */
export type SourceRecord = Record<string, unknown> & {
  key: string
  record_type?: string
  date?: string
  title?: string
  url?: string
  content?: string
}

export type RecordTab = 'clinical' | 'regulatory' | 'documents' | 'company-ir' | 'news' | 'publications' | 'conferences' | 'patents'

export interface RecordsQuery {
  q?: string
  type?: string[]
  phase?: string[]
  status?: string[]
  mentionsOnly?: boolean
  page?: number
  pageSize?: number
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** `{a: 1, b: ['x','y'], c: undefined}` → `?a=1&b=x,y` */
export function toQueryString(params: object): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    search.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export function useAssets() {
  return useQuery({ queryKey: ['assets'], queryFn: () => apiFetch<AssetSummary[]>('/assets') })
}

export function useAsset(id: string) {
  return useQuery({ queryKey: ['asset', id], queryFn: () => apiFetch<AssetDetail>(`/assets/${encodeURIComponent(id)}`) })
}

export function useTimeline(id: string, filters: TimelineFilters) {
  return useQuery({
    queryKey: ['asset', id, 'timeline', filters],
    queryFn: () =>
      apiFetch<{ events: JourneyEvent[]; total: number }>(
        `/assets/${encodeURIComponent(id)}/timeline${toQueryString(filters)}`,
      ),
    placeholderData: keepPreviousData,
  })
}

export function useRecords(id: string, tab: RecordTab, query: RecordsQuery) {
  return useQuery({
    queryKey: ['asset', id, 'records', tab, query],
    queryFn: () =>
      apiFetch<Page<SourceRecord>>(`/assets/${encodeURIComponent(id)}/records/${tab}${toQueryString(query)}`),
    placeholderData: keepPreviousData,
  })
}

export function useRecord(id: string, tab: RecordTab, key: string | null) {
  return useQuery({
    queryKey: ['asset', id, 'record', tab, key],
    queryFn: () =>
      apiFetch<SourceRecord>(`/assets/${encodeURIComponent(id)}/record/${tab}${toQueryString({ key })}`),
    enabled: key !== null,
  })
}

export function useAdverseEvents(id: string) {
  return useQuery({
    queryKey: ['asset', id, 'adverse-events'],
    queryFn: () => apiFetch<{ month: string; count: number }[]>(`/assets/${encodeURIComponent(id)}/series/adverse-events`),
  })
}

/** Share-price move after an event: % against the last close before day 0 (first trading day on/after the event). */
export interface MarketImpact {
  trading_day: string
  base_close: number
  days_measured: number
  day0: number
  day5: number | null
  day20: number | null
  dip: number | null
  /** Trading days after day 0 of the deepest dip / highest peak, and that day's close. */
  dip_day: number | null
  dip_close: number | null
  peak: number | null
  peak_day: number | null
  peak_close: number | null
}

export interface MarketEvent {
  id: string
  date: string
  title: string
  type: string
  category: EventCategory
  significance: Significance
  /** The drug (tracked asset) the event belongs to. */
  drug: { id: string; name: string }
  source: { collection: string; record_key: string } | null
  impact: MarketImpact | null
  /** Why there is no impact: before price history, upcoming, ... */
  note: string | null
}

export type AssetMarket =
  | { listed: false; company: string | null; note: string }
  | {
      listed: true
      ticker: string
      company: string
      listed_name: string | null
      exchange: string | null
      /** The asset's company is a subsidiary; this is its listed parent. */
      via_parent: boolean
      other_listings: string[]
      source: string | null
      currency: string | null
      as_of: string | null
      note: string
      /** Tracked drugs of the same listed company; `selected` ones contribute events. */
      drugs: { id: string; name: string; selected: boolean }[]
      /** Events per category for the selected drugs, before the category filter. */
      category_counts: Partial<Record<EventCategory, number>>
      bars: { date: string; close: number }[]
      events: MarketEvent[]
    }

export interface MarketFilters {
  drugs?: string[]
  category?: EventCategory[]
  significance?: Significance[]
}

export function useMarket(id: string, filters: MarketFilters) {
  return useQuery({
    queryKey: ['asset', id, 'market', filters],
    queryFn: () => apiFetch<AssetMarket>(`/assets/${encodeURIComponent(id)}/market${toQueryString(filters)}`),
    placeholderData: keepPreviousData,
  })
}
