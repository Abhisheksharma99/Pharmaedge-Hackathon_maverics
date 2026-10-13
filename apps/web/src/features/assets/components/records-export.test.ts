import type { RecordsPage, SourceRecord } from '../api'
import { exportedCount, fetchAllRecords, recordsTable } from './records-export'

const rec = (i: number, extra: Partial<SourceRecord> = {}): SourceRecord => ({ key: `k${i}`, title: `Record ${i}`, date: '2024-05-01', ...extra })

/** A records API over `n` records that answers each page as the API would. */
function serve(n: number) {
  const fetchMock = vi.fn(async (url: string) => {
    const u = new URL(url, 'http://x')
    const page = Number(u.searchParams.get('page'))
    const size = Number(u.searchParams.get('pageSize'))
    const items = Array.from({ length: Math.max(0, Math.min(size, n - (page - 1) * size)) }, (_, i) => rec((page - 1) * size + i))
    const body: RecordsPage = { items, total: n, page, pageSize: size, all: n + 10, facets: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('records export', () => {
  it('pages through every matching record with the panel’s search, facets and toggle', async () => {
    const fetchMock = serve(250)
    const { items, total } = await fetchAllRecords('trep', 'clinical', { q: 'teton', facets: { phases: 'PHASE3', conditions: '' }, companyOnly: true })
    expect(total).toBe(250)
    expect(items).toHaveLength(250)
    expect(items.map((r) => r.key)).toEqual(Array.from({ length: 250 }, (_, i) => `k${i}`))
    const urls = fetchMock.mock.calls.map(([u]) => new URL(u, 'http://x'))
    expect(urls.map((u) => u.searchParams.get('page'))).toEqual(['1', '2', '3'])
    for (const u of urls) {
      expect(u.pathname).toBe('/api/assets/trep/records/clinical')
      expect(u.searchParams.get('pageSize')).toBe('100')
      expect(u.searchParams.get('q')).toBe('teton')
      expect(u.searchParams.get('companyOnly')).toBe('true')
      expect(JSON.parse(u.searchParams.get('facets')!)).toEqual({ phases: 'PHASE3' })
    }
  })

  it('stops at the cap and reports the full match count', async () => {
    const fetchMock = serve(1234)
    const { items, total } = await fetchAllRecords('trep', 'news', {}, 250)
    expect(items).toHaveLength(250)
    expect(total).toBe(1234)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(exportedCount(250, 1234)).toBe('the first 250 of 1,234 records')
    expect(exportedCount(1, 1)).toBe('1 record')
  })

  it('exports the visible columns, the journey events and the source link (Indications once)', () => {
    const records = [
      rec(1, { url: 'https://pubmed.ncbi.nlm.nih.gov/1/', indications: ['PAH', 'Idiopathic pulmonary fibrosis (IPF)'], journey_events: [{ id: 'e1', title: 'TETON readout', date: '2025-03', category: 'clinical' }] }),
      rec(2, { url: 'javascript:alert(1)' }),
    ]
    const columns = [
      { header: 'Date', text: (r: SourceRecord) => String(r.date), date: true },
      { header: 'Title', text: (r: SourceRecord) => String(r.title) },
    ]
    const table = recordsTable({ sheet: 'Publications', columns, records, total: 2, journey: true, about: [['Tab', 'Publications']] })
    expect(table.columns).toEqual([{ header: 'Date', kind: 'date' }, { header: 'Title', kind: undefined }, { header: 'Indications', kind: undefined }, { header: 'Journey events', kind: undefined }, { header: 'Source link', kind: 'link' }])
    expect(table.rows).toEqual([
      ['2024-05-01', 'Record 1', 'PAH; IPF', 'TETON readout', 'https://pubmed.ncbi.nlm.nih.gov/1/'],
      ['2024-05-01', 'Record 2', '', '', ''],
    ])
    expect(table.about).toEqual([['Tab', 'Publications'], ['Records', 2]])

    const withIndication = recordsTable({ sheet: 'x', columns: [...columns, { header: 'Indication', text: () => 'PAH' }], records, total: 9000, journey: false, about: [] })
    expect(withIndication.columns.map((c) => c.header)).toEqual(['Date', 'Title', 'Indication', 'Source link'])
    expect(withIndication.about).toEqual([['Records', '2 of 9000 (capped at 5000)']])
  })
})
