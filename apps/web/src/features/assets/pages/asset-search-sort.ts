import type { TableExportResult } from '@/components/table-export-menu'
import { byKindThenName, type AssetSummary } from '../api'

/** Asset Search's sortable columns. */
export type SortKey = 'name' | 'company' | 'kind' | 'status' | 'events' | 'latest'

/** A sort as kept in `?sort=`: `events` low to high, `-events` high to low. No param = primary first, then A–Z. */
export interface AssetSort {
  key: SortKey
  desc: boolean
}

export const SORT_LABELS: Record<SortKey, string> = { name: 'Name', company: 'Company', kind: 'Kind', status: 'Status', events: 'Events', latest: 'Latest update' }
const KEYS = Object.keys(SORT_LABELS) as SortKey[]
/** How each direction reads: [ascending, descending]. */
const DIRECTIONS: Record<SortKey, [string, string]> = {
  name: ['A–Z', 'Z–A'],
  company: ['A–Z', 'Z–A'],
  kind: ['primary first', 'competitors first'],
  status: ['A–Z', 'Z–A'],
  events: ['fewest first', 'most first'],
  latest: ['oldest first', 'newest first'],
}

export function parseSort(value: string | null): AssetSort | null {
  if (!value) return null
  const desc = value.startsWith('-')
  const key = KEYS.find((k) => k === (desc ? value.slice(1) : value))
  return key ? { key, desc } : null
}

export const sortParam = (s: AssetSort) => `${s.desc ? '-' : ''}${s.key}`

/** "Events, most first" */
export const sortLabel = (s: AssetSort) => `${SORT_LABELS[s.key]}, ${DIRECTIONS[s.key][s.desc ? 1 : 0]}`

/** A header click: the same column flips; another starts high-to-low for counts and dates, A–Z for text. */
export function nextSort(current: AssetSort | null, key: SortKey): AssetSort {
  return current?.key === key ? { key, desc: !current.desc } : { key, desc: key === 'events' || key === 'latest' }
}

/** The status pill's words, which the Status column sorts by. */
export function statusLabel(asset: Pick<AssetSummary, 'status'>, progress: number | null): string {
  if (progress !== null || asset.status === 'onboarding') return 'Collecting'
  return asset.status === 'failed' ? 'Collection failed' : 'Ready'
}

const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

/** `assets` in `sort` order; ties (and no sort) keep primary first, then A–Z. Assets without an update sort last either way. */
export function sortAssets(assets: AssetSummary[], sort: AssetSort | null, progressOf: (id: string) => number | null): AssetSummary[] {
  const base = [...assets].sort(byKindThenName)
  if (!sort) return base
  const dir = sort.desc ? -1 : 1
  const compare = (a: AssetSummary, b: AssetSummary): number => {
    switch (sort.key) {
      case 'name':
        return dir * text(a.name, b.name)
      case 'company':
        return dir * text(a.company.name, b.company.name)
      case 'kind':
        return dir * ((a.kind === 'primary' ? 0 : 1) - (b.kind === 'primary' ? 0 : 1))
      case 'status':
        return dir * text(statusLabel(a, progressOf(a.id)), statusLabel(b, progressOf(b.id)))
      case 'events':
        return dir * (a.counts.events - b.counts.events)
      case 'latest':
        if (!a.latestEvent || !b.latestEvent) return (a.latestEvent ? 0 : 1) - (b.latestEvent ? 0 : 1)
        return dir * a.latestEvent.date.localeCompare(b.latestEvent.date)
    }
  }
  return base.sort(compare)
}

/** The assets Asset Search shows, in its order, as a CSV / Excel export with an About sheet naming the filters and sort. */
export function assetsExport({
  assets,
  regions,
  progressOf,
  filters,
  sort,
  origin,
}: {
  assets: AssetSummary[]
  /** Approved regions per asset id, where loaded. */
  regions: Record<string, string[] | undefined>
  progressOf: (id: string) => number | null
  filters: string
  sort: AssetSort | null
  origin: string
}): TableExportResult {
  const n = assets.length
  return {
    stem: 'asset-search',
    done: `Exported ${n} asset${n === 1 ? '' : 's'}`,
    table: {
      sheet: 'Assets',
      columns: [
        { header: 'Asset' },
        { header: 'Kind' },
        { header: 'Competitor of' },
        { header: 'Company' },
        { header: 'Brands and aliases' },
        { header: 'Approved indications' },
        { header: 'Investigational indications' },
        { header: 'Mechanism' },
        { header: 'Approved in' },
        { header: 'Status' },
        { header: 'Events' },
        { header: 'Latest update' },
        { header: 'Latest update date', kind: 'date' },
        { header: 'Asset link', kind: 'link' },
      ],
      rows: assets.map((a) => [
        a.name,
        a.kind === 'primary' ? 'Primary' : 'Competitor',
        a.competitorOf.map((p) => p.name).join('; '),
        a.company.name,
        a.aliases.filter((x) => x.toLowerCase() !== a.name.toLowerCase()).join('; '),
        (a.tags.indications ?? []).join('; '),
        (a.tags.investigational_indications ?? []).join('; '),
        a.tags.mechanism ?? '',
        (regions[a.id] ?? []).join('; '),
        statusLabel(a, progressOf(a.id)),
        String(a.counts.events),
        a.latestEvent?.title ?? '',
        a.latestEvent?.date ?? '',
        `${origin}/assets/${encodeURIComponent(a.id)}/overview`,
      ]),
      about: [
        ['Page', 'Asset Search'],
        ['Filters', filters],
        ['Sort', sort ? sortLabel(sort) : 'Primary first, then name A–Z'],
        ['Assets', n],
      ],
    },
  }
}
