import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { BRANCH_PALETTE } from '../constants'
import type { Branch, JourneyEventV3 } from '../types'
import type { ExportContext } from './model'
import { buildXlsx } from './xlsx'
import { timelineGrid } from './xlsx-timeline'

const ev = (id: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch: 'PAH', type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'Low', is_milestone: false, sources: [], via: 'journey', ...extra,
})

const BRANCHES: Branch[] = [
  { id: 'PH-ILD', label: 'PH-ILD', full: 'PH due to interstitial lung disease', color: '#0b7a6f', off: -1, status: '', origin: 'rule' },
  { id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', off: 0, trunk: true, status: '', origin: 'rule' },
]

// 2015–2027: 13 years, one column per month. Newest first, as the journey can list them.
const EVENTS = [
  ev('x', '2027-03', { is_milestone: true, category: 'clinical', branch: 'PH-ILD', title: 'TETON-2 readout', significance: 'High' }),
  ev('n', '2020-01-09', { via: 'user', category: 'company', title: 'Team note on launch' }),
  ev('b2', '2017-02-20', { category: 'clinical', branch: 'PH-ILD', title: 'INCREASE results', significance: 'High' }),
  ev('b1', '2017-02-01', { category: 'clinical', branch: 'PH-ILD', span: ['PAH'], title: 'INCREASE starts' }),
  ev('a', '2015-05-21', { title: 'FDA approves Orenitram', significance: 'High' }),
]

const ctx = (over: Partial<ExportContext> = {}): ExportContext => ({
  asset: { id: 'treprostinil', name: 'Treprostinil', company: 'United Therapeutics' },
  scope: 'key',
  order: 'newest',
  filters: { cats: [], mine: null, ind: null, q: '' },
  events: EVENTS,
  exportedAt: new Date(2026, 9, 10, 14, 5),
  origin: 'https://pharmaedge.test',
  ...over,
})

async function load(blob: Blob) {
  const buf = await blob.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return { wb, zip: await JSZip.loadAsync(buf) }
}

/** Column of the month bucket for `YYYY-MM` on a grid starting in `y0` (labels take columns A–C). */
const monthCol = (y0: number, ym: string) => 4 + (Number(ym.slice(0, 4)) - y0) * 12 + Number(ym.slice(5, 7)) - 1

describe('Excel timeline sheet', () => {
  it('adds a Timeline sheet after Journey: lanes trunk first, one column per month, frozen labels and header', async () => {
    const { wb } = await load(await buildXlsx(ctx(), { branches: BRANCHES }))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Journey', 'Timeline', 'About'])
    const ws = wb.getWorksheet('Timeline')!
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 5, zoomScale: 100 })
    expect(ws.pageSetup).toMatchObject({ orientation: 'landscape', fitToPage: true, fitToHeight: 1 })
    // 2015–2027 × 12 months after the stripe / lane / indication columns.
    expect(ws.columnCount).toBe(3 + 13 * 12)
    expect(ws.getColumn(4).width).toBe(3)
    expect(ws.getCell(4, 4).value).toBe(2015)
    expect(ws.getCell(4, 4).isMerged).toBe(true)
    expect(ws.getCell(5, 4).value).toBe('J')
    // Today (Oct 2026) is the dark column.
    expect(ws.getCell(5, monthCol(2015, '2026-10')).fill).toMatchObject({ fgColor: { argb: 'FF101828' } })
    // Lanes: the trunk first, then the branch, then team notes, with colour stripes and full names.
    const lane = (r: number) => [ws.getCell(r, 2).value, ws.getCell(r, 3).value, (ws.getCell(r, 1).fill as ExcelJS.FillPattern).fgColor?.argb]
    expect([lane(6), lane(7), lane(8)]).toEqual([
      ['PAH', 'Pulmonary arterial hypertension', 'FF2347D9'],
      ['PH-ILD', 'PH due to interstitial lung disease', 'FF0B7A6F'],
      ['Team notes', 'Notes the team added', 'FF7A5AF8'],
    ])
    expect(ws.rowCount).toBe(8)
    const about = Object.fromEntries(wb.getWorksheet('About')!.getSheetValues().filter(Boolean).map((r) => [(r as unknown[])[1], (r as unknown[])[2]]))
    expect(about.Timeline).toMatch(/one column per month, 2015–2027\. Time runs left to right there, while the Journey sheet lists newest first/)
  })

  it('fills event cells with the category colour, a note listing the events and a link to the first', async () => {
    const { wb, zip } = await load(await buildXlsx(ctx(), { branches: BRANCHES }))
    const ws = wb.getWorksheet('Timeline')!
    const one = ws.getCell(6, monthCol(2015, '2015-05'))
    expect(one.value).toMatchObject({ text: '●', hyperlink: 'https://pharmaedge.test/journey/treprostinil?focus=a' })
    expect(one.fill).toMatchObject({ fgColor: { argb: 'FF2347D9' } })
    expect(one.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } })
    // High significance: an ink outline.
    expect(one.border?.top).toMatchObject({ style: 'medium' })
    const note = (c: ExcelJS.Cell) => (c.note as ExcelJS.Comment).texts!.map((t) => t.text).join('')
    expect(note(one)).toContain('FDA approves Orenitram\n2015-05-21 · Regulatory · High significance\nIndications: PAH')

    // Two events in Feb 2017 on PH-ILD: a count, the first event's link, both in the note, clinical fill.
    const two = ws.getCell(7, monthCol(2015, '2017-02'))
    expect(two.value).toMatchObject({ text: '×2', hyperlink: 'https://pharmaedge.test/journey/treprostinil?focus=b1' })
    expect(two.fill).toMatchObject({ fgColor: { argb: 'FF0B7A6F' } })
    expect(note(two)).toMatch(/2 events · Feb 2017[\s\S]*INCREASE starts[\s\S]*Indications: PH-ILD, PAH[\s\S]*INCREASE results/)

    // An expected milestone: the light fill and a dashed outline in its category colour.
    const expected = ws.getCell(7, monthCol(2015, '2027-03'))
    expect(expected.fill).toMatchObject({ fgColor: { argb: 'FFE6F4F2' } })
    expect(expected.border?.left).toMatchObject({ style: 'mediumDashed', color: { argb: 'FF0B7A6F' } })

    // Team notes sit on their own lane; every event is placed exactly once.
    expect(ws.getCell(8, monthCol(2015, '2020-01')).value).toMatchObject({ text: '●' })
    let placed = 0
    ws.eachRow((row, r) => {
      if (r > 5) row.eachCell((c) => {
        const t = (c.value as { text?: string } | null)?.text
        if (t) placed += t === '●' ? 1 : Number(t.slice(1))
      })
    })
    expect(placed).toBe(EVENTS.length)

    // ExcelJS's 2×4-cell note boxes are widened to readable ones.
    const vml = await zip.file(/^xl\/drawings\/vmlDrawing\d+\.vml$/)[0]!.async('string')
    const anchors = [...vml.matchAll(/<x:Anchor>([^<]*)<\/x:Anchor>/g)].map((m) => m[1]!.split(', ').map(Number))
    expect(anchors).toHaveLength(5) // 4 event cells (one holds 2 events) + the Today header
    for (const [l, , , , r] of anchors) expect(r! - l!).toBeGreaterThan(2)
  })

  it('switches to quarter columns past 25 years', async () => {
    const long = [ev('old', '1996-07-01'), ev('new', '2026-01-15', { category: 'ip' })]
    const g = timelineGrid(long, '2026-10-10')
    expect(g).toMatchObject({ bucket: 'quarter', per: 4, y0: 1996, y1: 2026, placed: 2 })
    expect([...g.lanes[0]!.cells.keys()]).toEqual([2, 30 * 4])
    expect(g.today).toBe(30 * 4 + 3)
    const { wb } = await load(await buildXlsx(ctx({ events: long }), { branches: BRANCHES }))
    const ws = wb.getWorksheet('Timeline')!
    expect(ws.columnCount).toBe(3 + 31 * 4)
    expect([ws.getCell(5, 4).value, ws.getCell(5, 7).value]).toEqual(['Q1', 'Q4'])
    expect(ws.getCell(6, 4 + 2).fill).toMatchObject({ fgColor: { argb: 'FF2347D9' } })
    expect(ws.getCell(6, 4 + 120).fill).toMatchObject({ fgColor: { argb: 'FF6941C6' } })
  })

  it('without branch docs, takes lanes from the events: ordered by first event, palette colours, only lanes with events', () => {
    const g = timelineGrid([ev('1', '2019-01', { branch: 'CTEPH' }), ev('2', '2018-03', { branch: 'PH-ILD' }), ev('3', '2020-05', { branch: undefined })], '2026-10-10')
    expect(g.lanes.map((l) => [l.label, l.color])).toEqual([
      ['PH-ILD', BRANCH_PALETTE[0]],
      ['CTEPH', BRANCH_PALETTE[1]],
    ])
    // An event without a branch goes on the trunk (the first lane), as the app draws it.
    expect(g.lanes[0]!.cells.size).toBe(2)
    // A branch filter keeps only the lanes that still hold events.
    const one = timelineGrid([ev('1', '2019-01', { branch: 'CTEPH' })], '2026-10-10', BRANCHES)
    expect(one.lanes.map((l) => l.id)).toEqual(['PAH'])
  })
})
