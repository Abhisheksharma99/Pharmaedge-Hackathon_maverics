import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
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
  /** Journey events built from this record (records endpoints; DC §B). */
  journey_events?: RecordEventRef[]
}

/** A journey event a record feeds, as the records API lists it. */
export interface RecordEventRef {
  id: string
  title: string
  date: string
  category: EventCategory
  significance?: Significance
}

export type RecordTab = 'clinical' | 'regulatory' | 'documents' | 'company-ir' | 'news' | 'publications' | 'conferences' | 'patents'

/** Which asset tab shows a source record of this collection. */
export const TAB_FOR_COLLECTION: Record<string, RecordTab> = {
  fda_records: 'regulatory',
  ema_records: 'regulatory',
  trial_records: 'clinical',
  company_records: 'company-ir',
  articles: 'news',
  publication_records: 'publications',
  conference_records: 'conferences',
  patent_records: 'patents',
}

export interface RecordsQuery {
  q?: string
  type?: string[]
  phase?: string[]
  status?: string[]
  mentionsOnly?: boolean
  /** Trials: only studies sponsored by the asset's company. */
  companyOnly?: boolean
  /** Selected facet values by facet key; sent as JSON. */
  facets?: Record<string, string>
  page?: number
  pageSize?: number
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** A records page with the panel's whole-tab counts: `all` records and the values of each facet. */
export interface RecordsPage extends Page<SourceRecord> {
  all: number
  facets: { key: string; label: string; values: { value: string; count: number }[] }[]
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
    queryFn: () => {
      const { facets, ...rest } = query
      const picked = Object.fromEntries(Object.entries(facets ?? {}).filter(([, v]) => v))
      const params = Object.keys(picked).length ? { ...rest, facets: JSON.stringify(picked) } : rest
      return apiFetch<RecordsPage>(`/assets/${encodeURIComponent(id)}/records/${tab}${toQueryString(params)}`)
    },
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

/** Every word of `q` appears in the asset's name, brands, company, indications or mechanism (Asset Search, ⌘K). */
export function assetMatches(asset: AssetSummary, q: string): boolean {
  const haystack = [
    asset.name,
    ...asset.aliases,
    asset.company.name,
    ...(asset.tags.indications ?? []),
    ...(asset.tags.investigational_indications ?? []),
    asset.tags.mechanism ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word))
}

/** Primary assets first, then by name. */
export const byKindThenName = (a: Pick<AssetSummary, 'kind' | 'name'>, b: Pick<AssetSummary, 'kind' | 'name'>) =>
  Number(a.kind === 'competitor') - Number(b.kind === 'competitor') || a.name.localeCompare(b.name)

/** Details of several assets (approval regions for cards and tables), sharing the ['asset', id] cache; undefined until loaded. */
export function useAssetDetails(ids: string[]): Record<string, AssetDetail | undefined> {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['asset', id],
      queryFn: () => apiFetch<AssetDetail>(`/assets/${encodeURIComponent(id)}`),
    })),
    combine: (results) => Object.fromEntries(results.map((r, i) => [ids[i], r.data])) as Record<string, AssetDetail | undefined>,
  })
}
