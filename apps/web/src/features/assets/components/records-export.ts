import { apiFetch } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { ExportColumn, ExportTable } from '@/lib/table-export'
import { recordsPath, type RecordsPage, type RecordsQuery, type RecordTab, type SourceRecord } from '../api'
import { recordIndications } from './record-indications'
import { recordUrl } from './record-text'
import type { Column } from './records-view'

/** The most rows one export holds; past it the export says it was capped. */
export const EXPORT_CAP = 5000
/** The API's largest page. */
const EXPORT_PAGE = 100
/** Pages fetched at once. */
const PARALLEL = 4

/**
 * Every record matching `query` (search, facets, toggle), in the API's order, by paging through the records API:
 * up to `cap` records, with the full match count in `total`. A record that moves between pages while paging is kept once.
 */
export async function fetchAllRecords(
  assetId: string,
  tab: RecordTab,
  query: Omit<RecordsQuery, 'page' | 'pageSize'>,
  cap = EXPORT_CAP,
): Promise<{ items: SourceRecord[]; total: number }> {
  const fetchPage = (page: number) => apiFetch<RecordsPage>(recordsPath(assetId, tab, { ...query, page, pageSize: EXPORT_PAGE }))
  const first = await fetchPage(1)
  const pages = Math.ceil(Math.min(first.total, cap) / EXPORT_PAGE)
  const items = [...first.items]
  for (let p = 2; p <= pages; p += PARALLEL) {
    const batch = await Promise.all(Array.from({ length: Math.min(PARALLEL, pages - p + 1) }, (_, i) => fetchPage(p + i)))
    for (const b of batch) items.push(...b.items)
  }
  const unique = [...new Map(items.map((r) => [r.key, r])).values()]
  return { items: unique.slice(0, cap), total: first.total }
}

/** "1,234 records" or, past the cap, "the first 5,000 of 6,120 records". */
export function exportedCount(rows: number, total: number): string {
  return rows < total ? `the first ${formatNumber(rows)} of ${formatNumber(total)} records` : `${formatNumber(rows)} record${rows === 1 ? '' : 's'}`
}

/**
 * A records tab's rows as an export table: the tab's visible columns as text (Indications added when the tab shows
 * none), the journey events each record feeds when the tab shows that column, and the record's source link.
 */
export function recordsTable({
  sheet,
  columns,
  records,
  total,
  journey,
  about,
}: {
  sheet: string
  columns: Pick<Column, 'header' | 'text' | 'date'>[]
  records: SourceRecord[]
  total: number
  journey: boolean
  /** Asset, tab and filters, first on the About sheet. */
  about: [string, string][]
}): ExportTable {
  const cols: { header: string; kind?: ExportColumn['kind']; text: (r: SourceRecord) => string }[] = columns.map((c) => ({ header: c.header, kind: c.date ? 'date' : undefined, text: c.text }))
  if (!columns.some((c) => c.header === 'Indication')) cols.push({ header: 'Indications', text: (r) => recordIndications(r).join('; ') })
  if (journey) cols.push({ header: 'Journey events', text: (r) => (r.journey_events ?? []).map((e) => e.title).join('; ') })
  cols.push({ header: 'Source link', kind: 'link', text: (r) => recordUrl(r) ?? '' })
  return {
    sheet,
    columns: cols.map(({ header, kind }) => ({ header, kind })),
    rows: records.map((r) => cols.map((c) => c.text(r))),
    about: [...about, ['Records', records.length < total ? `${records.length} of ${total} (capped at ${EXPORT_CAP})` : records.length]],
  }
}
