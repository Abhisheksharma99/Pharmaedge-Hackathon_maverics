import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type { AssetAnalytics } from '@/features/analytics/api'
import { branchModel, filterJourney } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { buildExport } from './build'
import { csvField, toCsv } from './csv'
import { toIcs } from './ics'
import { toJson } from './json'
import { COLUMNS, exportFileName, filtersLabel, upcomingMilestones, type ExportContext } from './model'
import { buildPdf, pdfText, unicodeText } from './pdf'
import { buildPptx, clip, countdown, keyHighlights, LONG_TIMELINE, PPTX_TYPE, yearCounts } from './pptx'
import { pageRail, railLanes, ROWS_PER_SLIDE, timelinePages } from './pptx-timeline'
import { buildXlsx } from './xlsx'

const ev = (id: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch: 'PAH', type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})

const EVENTS = [
  ev('a', '2002-05-21', { title: 'FDA approves Remodulin, "first" PAH therapy, for Sàrl', summary: 'Line one\nline two', impact: 'First prostacyclin by infusion.', sources: [{ collection: 'fda_records', record_key: 'NDA021272' }] }),
  ev('b', '2017-02', { category: 'clinical', type: 'trial_start', branch: 'PH-ILD', span: ['PAH'], title: '=INCREASE trial starts', sources: [{ collection: 'articles', record_key: 'https://example.com/increase' }], merged_sources: [{ collection: 'articles', record_key: 'https://example.com/increase' }, { collection: 'trial_records', record_key: 'NCT02630316' }] }),
  ev('c', '2027-03', { is_milestone: true, category: 'clinical', branch: undefined, indications: ['Idiopathic pulmonary fibrosis (IPF)'], title: 'TETON-2 readout; topline', significance: 'Medium' }),
]

const BRANCHES: Branch[] = [
  { id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', off: 0, trunk: true, status: 'Approved · EU, US', origin: 'ai' },
  { id: 'PH-ILD', label: 'PH-ILD', full: 'Pulmonary hypertension associated with ILD', color: '#6941c6', off: 2, from: 'PAH', status: 'Approved · US', origin: 'ai' },
  { id: 'CLI', label: 'CLI', full: 'Critical limb ischemia', color: '#b54708', off: -1, from: 'PAH', status: 'Closed · terminated', ended: 'Terminated', origin: 'ai' },
]

const ANALYTICS = {
  pipeline: [
    { id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', ended: null, stage: 4, n: 3, next: null, since: '2002-05-21' },
    { id: 'PH-ILD', label: 'PH-ILD', full: 'PH-ILD', color: '#6941c6', ended: null, stage: 4, n: 1, next: { id: 'c', title: 'TETON-2 readout', date: '2027-03-01' }, since: '2017-02' },
    { id: 'CLI', label: 'CLI', full: 'Critical limb ischemia', color: '#b54708', ended: 'Terminated', stage: 1, n: 0, next: null, since: '2003-02-01' },
  ],
  trials: [
    { nct: 'NCT1', name: 'LATE', title: 'Late', phase: 'Phase 3', status: 'RECRUITING', start: '2020-01-01', pcd: '2027-01-01', enrollment: 300, indication: 'Pulmonary arterial hypertension (PAH)', company: true, active: true },
    { nct: 'NCT2', name: 'EARLY', title: 'Early', phase: 'Phase 1', status: 'COMPLETED', start: '2010-01-01', pcd: '2011-01-01', enrollment: 20, indication: 'PAH', company: true, active: false },
  ],
  landscape: {
    cols: ['Pulmonary arterial hypertension (PAH)'],
    rows: [
      { id: 'treprostinil', name: 'Treprostinil', company: 'United Therapeutics', me: true, cells: { 'Pulmonary arterial hypertension (PAH)': 'approved' } },
      { id: 'rival', name: 'Rival', company: null, me: false, cells: { 'Pulmonary arterial hypertension (PAH)': 'investigational' } },
      { id: 'other', name: 'Other', company: null, me: false, cells: { 'Pulmonary arterial hypertension (PAH)': 'none' } },
    ],
  },
  stats: { approved: [{ indication: 'PAH', regions: ['US', 'EU'] }, { indication: 'PH-ILD', regions: ['US'] }] },
} as unknown as AssetAnalytics

const ctx = (over: Partial<ExportContext> = {}): ExportContext => ({
  asset: { id: 'treprostinil', name: 'Treprostinil', company: 'United Therapeutics' },
  scope: 'key',
  order: 'oldest',
  filters: { cats: [], mine: null, ind: null, q: '' },
  events: EVENTS,
  exportedAt: new Date(2026, 9, 10, 14, 5),
  origin: 'https://pharmaedge.test',
  ...over,
})

/** Minimal RFC 4180 parser: rows of fields (quoted fields may hold commas, quotes and newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += c
  }
  return rows
}

describe('journey export', () => {
  it('names files <asset>-journey-<scope>-<day>.<ext> and describes the filters', () => {
    expect(exportFileName(ctx(), 'csv')).toBe('treprostinil-journey-key-events-2026-10-10.csv')
    expect(exportFileName(ctx({ scope: 'all' }), 'xlsx')).toBe('treprostinil-journey-all-events-2026-10-10.xlsx')
    expect(filtersLabel({ cats: [], mine: null })).toBe('None')
    expect(filtersLabel({ cats: ['clinical', 'ip'], mine: 'starred', ind: 'PAH', q: ' teton ' })).toBe('Category: Clinical, Patents · Starred only · Indication: PAH · Title contains “teton”')
  })

  it('names the selected branch in the file name and in every format’s metadata', async () => {
    const branched = ctx({ filters: { cats: [], mine: null, branch: 'PH-ILD' } })
    expect(filtersLabel(branched.filters)).toBe('Branch: PH-ILD')
    expect(exportFileName(branched, 'csv')).toBe('treprostinil-journey-key-events-ph-ild-2026-10-10.csv')
    expect(JSON.parse(toJson(branched)).filters).toMatchObject({ branch: 'PH-ILD' })
    expect(toIcs(branched)).toContain('X-WR-CALDESC:Key events · Filters: Branch: PH-ILD\r\n')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await (await buildXlsx(branched)).arrayBuffer())
    expect(wb.getWorksheet('About')!.getCell('B5').value).toBe('Branch: PH-ILD')
    const zip = await JSZip.loadAsync(await (await buildPptx(branched)).arrayBuffer())
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('Filters: Branch: PH-ILD')
    expect(new TextDecoder('latin1').decode(new Uint8Array(await (await buildPdf(branched)).arrayBuffer()))).toContain('Filters: Branch: PH-ILD')
  })

  it('writes RFC 4180 CSV with a BOM, the columns in order, escaped fields and formula-safe text', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)")

    const csv = toCsv(ctx())
    expect(csv.startsWith('﻿Date,Expected,Title,Category,Type,Significance,Indications,Branch,Summary / why it matters,Sources,Event link\r\n')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    const rows = parseCsv(csv.slice(1))
    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual([...COLUMNS])
    expect(rows[1]).toEqual([
      '2002-05-21', 'no', 'FDA approves Remodulin, "first" PAH therapy, for Sàrl', 'Regulatory', 'approval', 'High', 'PAH', 'PAH',
      'Line one\nline two\nWhy it matters: First prostacyclin by infusion.', 'fda_records:NDA021272', 'https://pharmaedge.test/journey/treprostinil?focus=a',
    ])
    // Sources merged and de-duplicated; spanned indications listed; a leading "=" kept as text.
    expect(rows[2]!.slice(0, 10)).toEqual(['2017-02', 'no', "'=INCREASE trial starts", 'Clinical', 'trial_start', 'High', 'PH-ILD; PAH', 'PH-ILD', '', 'articles:https://example.com/increase; trial_records:NCT02630316'])
    expect(rows[3]!.slice(0, 8)).toEqual(['2027-03', 'yes', 'TETON-2 readout; topline', 'Clinical', 'approval', 'Medium', 'IPF', ''])
  })

  it('exports the rows the journey shows, in its order', () => {
    const shown = filterJourney(EVENTS, { cats: ['clinical'], mine: null }, []).reverse()
    const rows = parseCsv(toCsv(ctx({ events: shown, order: 'newest', filters: { cats: ['clinical'], mine: null } })).slice(1))
    expect(rows.slice(1).map((r) => r[0])).toEqual(['2027-03', '2017-02'])
    const doc = JSON.parse(toJson(ctx({ events: shown, order: 'newest', filters: { cats: ['clinical'], mine: null } })))
    expect(doc.events.map((e: { id: string }) => e.id)).toEqual(['c', 'b'])
    expect(doc.order).toBe('newest')
    expect(doc.filters.categories).toEqual(['clinical'])
  })

  it('writes JSON with the asset, export time, scope, filters, order and full events', () => {
    const doc = JSON.parse(toJson(ctx({ filters: { cats: [], mine: 'starred', ind: 'PAH', q: 'fda' } })))
    expect(Object.keys(doc)).toEqual(['asset', 'exportedAt', 'scope', 'filters', 'order', 'events'])
    expect(doc.asset).toEqual({ id: 'treprostinil', name: 'Treprostinil' })
    expect(doc.exportedAt).toBe(new Date(2026, 9, 10, 14, 5).toISOString())
    expect(doc).toMatchObject({ scope: 'key', order: 'oldest', filters: { categories: [], mine: 'starred', indication: 'PAH', title: 'fda' } })
    expect(doc.events).toHaveLength(3)
    expect(doc.events[1]).toMatchObject({
      id: 'b', date: '2017-02', expected: false, title: '=INCREASE trial starts', category: 'clinical', type: 'trial_start', significance: 'High',
      indications: ['PH-ILD', 'PAH'], branch: 'PH-ILD', via: 'journey', link: 'https://pharmaedge.test/journey/treprostinil?focus=b',
      sources: [{ collection: 'articles', record_key: 'https://example.com/increase', url: 'https://example.com/increase' }, { collection: 'trial_records', record_key: 'NCT02630316' }],
    })
    expect(doc.events[2]).toMatchObject({ expected: true, indications: ['IPF'], targets: ['Idiopathic pulmonary fibrosis (IPF)'], branch: null })
  })

  it('builds an Excel workbook with a bold frozen header, date cells, an autofilter and an About sheet', async () => {
    const blob = await buildXlsx(ctx({ filters: { cats: ['clinical'], mine: null } }))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const ws = wb.getWorksheet('Journey')!
    expect(ws.getRow(1).values).toEqual([undefined, ...COLUMNS])
    expect(ws.getRow(1).font?.bold).toBe(true)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.autoFilter).toBeTruthy()
    expect(ws.rowCount).toBe(4)
    expect(ws.getCell('A2').value).toEqual(new Date(Date.UTC(2002, 4, 21)))
    expect(ws.getCell('A2').numFmt).toBe('yyyy-mm-dd')
    expect(ws.getCell('A3').numFmt).toBe('yyyy-mm')
    expect(ws.getCell('C2').value).toBe('FDA approves Remodulin, "first" PAH therapy, for Sàrl')
    expect(ws.getCell('B4').value).toBe('yes')
    expect(ws.getCell('K2').value).toMatchObject({ hyperlink: 'https://pharmaedge.test/journey/treprostinil?focus=a' })
    const about = wb.getWorksheet('About')!
    const facts = Object.fromEntries(about.getSheetValues().filter(Boolean).map((r) => [(r as unknown[])[1], (r as unknown[])[2]]))
    expect(facts).toMatchObject({ Asset: 'Treprostinil (United Therapeutics)', Scope: 'Key events', Filters: 'Category: Clinical', Order: 'Oldest first', Events: 3 })
  })

  it('builds a PDF report (smoke) and keeps its text drawable', async () => {
    expect(pdfText('Sàrl – “quoted” ≥ 5 … Łódź 中')).toBe('Sàrl - "quoted" >= 5 ... ?ódz ?')
    const many = Array.from({ length: 520 }, (_, i) => ev(`e${i}`, `${2000 + (i % 26)}-01-15`, { title: `A long event title number ${i} `.repeat(4) }))
    const blob = await buildPdf(ctx({ scope: 'all', events: many }))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text).toContain('Treprostinil: asset journey')
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1)
  })

  it('embeds Inter in the PDF so non-Latin-1 text prints (smoke)', async () => {
    expect(unicodeText('≥ 5 β – ’ ® ™ μg （TETON）： 中')).toBe('≥ 5 β – ’ ® ™ μg (TETON): ?')
    // The fonts are bundled assets: serve them from disk as the dev server would.
    const fetchMock = vi.fn(async (url: string) => new Response(readFileSync(join(process.cwd(), url.replace(/\?.*$/, '')))))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const blob = await buildPdf(ctx({ events: [ev('u', '2024-03-01', { title: 'FEV1 ≥ 10% with β-agonist – Tyvaso® DPI™ ’25' })] }))
      expect(fetchMock.mock.calls.map(([u]) => u).join(' ')).toMatch(/Inter-Regular\.ttf.*Inter-Bold\.ttf/)
      const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))
      // Regular and Bold, each embedded as a TrueType font file.
      expect(text.match(/\/FontName \/Inter\b/g)).toHaveLength(2)
      expect(text.match(/\/FontFile2 /g)).toHaveLength(2)
      // The characters reach the page: each drawn glyph maps back to its code point in the font's ToUnicode map.
      for (const code of ['2265', '03b2', '2013', '00ae', '2122', '2019']) expect(text.toLowerCase()).toMatch(new RegExp(`<${code}>`))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('splits the timeline into slides of at most 10 lines, with year rows and "(cont.)" rows', () => {
    const lines = (pages: ReturnType<typeof timelinePages>) => pages.map((p) => p.map((l) => ('year' in l ? `${l.year}${l.cont ? '+' : ''}` : l.event.id)))
    expect(ROWS_PER_SLIDE).toBe(10)
    const year = Array.from({ length: 25 }, (_, i) => ev(`y${i}`, '2019-01-01'))
    const pages = lines(timelinePages(year))
    expect(pages.map((p) => p.length)).toEqual([10, 10, 8])
    expect(pages.map((p) => p[0])).toEqual(['2019', '2019+', '2019+'])
    // A year never starts on a slide's last line: 2001 and its 8 events, then 2002 opens the next slide.
    const two = lines(timelinePages([...Array.from({ length: 8 }, (_, i) => ev(`a${i}`, '2001-01-01')), ev('b', '2002-01-01')]))
    expect(two).toEqual([['2001', ...Array.from({ length: 8 }, (_, i) => `a${i}`)], ['2002', 'b']])
    expect(clip('A long event title that keeps going on and on', 20)).toBe('A long event title…')
    expect(clip('short', 20)).toBe('short')
  })

  it('places the rail: a dot level with each row, branch lanes in offset order, fork elbows, end caps and the Today line', () => {
    const model = branchModel(BRANCHES)
    const lanes = railLanes(EVENTS, model, false, 1.4, 2.65)
    // CLI has no event here, so no lane; PH-ILD (offset 2) sits right of the trunk and forks from it.
    expect(lanes.map((l) => l.id)).toEqual(['PAH', 'PH-ILD'])
    expect(lanes[1]!.x).toBeGreaterThan(lanes[0]!.x)
    expect(lanes[1]).toMatchObject({ from: 'PAH', first: 1, last: 1 })
    const at = (list: JourneyEventV3[]) => (e: JourneyEventV3) => list.indexOf(e)
    // Rows: header 0.32 from 1.45, year rows 0.3, event rows 0.48.
    const rail = pageRail(timelinePages(EVENTS)[0]!, at(EVENTS), lanes, model, false, 1.45, '2026-10-10')
    expect(rail.dots.map((d) => [d.e.id, d.lane.id])).toEqual([['a', 'PAH'], ['b', 'PH-ILD'], ['c', 'PAH']])
    rail.dots.forEach((d, i) => expect(d.y).toBeCloseTo([2.31, 3.09, 3.87][i]!))
    expect(rail.years.map((y) => y.year)).toEqual(['2002', '2017', '2027'])
    expect(rail.dots[1]!.span).toEqual([lanes[0]!.x])
    expect(rail.forks).toHaveLength(1)
    expect(rail.forks[0]).toMatchObject({ x1: lanes[0]!.x })
    expect(rail.forks[0]!.y).toBeCloseTo(3.09 - 0.2)
    expect(rail.today).toBeCloseTo(3.09 + 0.24)
    // Newest first time runs up: the fork is below the branch's first event.
    const newest = [...EVENTS].reverse()
    const up = pageRail(timelinePages(newest)[0]!, at(newest), railLanes(newest, model, true, 1.4, 2.65), model, true, 1.45, '2026-10-10')
    expect(up.dots.map((d) => d.e.id)).toEqual(['c', 'b', 'a'])
    expect(up.forks[0]!.y).toBeCloseTo(up.dots[1]!.y + 0.2)
    // An ended branch is capped just after its last event in time.
    const cli = [ev('x', '2003-02-01', { branch: 'CLI' }), ev('y', '2003-03-01', { branch: 'CLI' })]
    const capped = pageRail(timelinePages(cli)[0]!, at(cli), railLanes(cli, model, false, 1.4, 2.65), model, false, 1.45, '2026-10-10')
    expect(capped.caps.map((c) => c.lane.id)).toEqual(['CLI'])
    expect(capped.caps[0]!.y).toBeCloseTo(capped.dots[1]!.y + 0.2)
    expect(capped.today).toBeNull()
    // Branch-filtered, the trunk's first row may come after the fork: the trunk still reaches the elbow.
    const only = [EVENTS[1]!]
    const filtered = pageRail(timelinePages(only)[0]!, at(only), railLanes(only, model, false, 1.4, 2.65), model, false, 1.45, '2026-10-10')
    const trunk = filtered.segments.find((x) => x.lane.trunk)!
    expect(trunk.y1).toBeCloseTo(filtered.forks[0]!.y)
  })

  it('builds a PowerPoint deck: title, overview, highlights, timeline, upcoming and sources slides on a footer master', async () => {
    const { blob, filename } = await buildExport('pptx', ctx())
    expect(filename).toBe('treprostinil-journey-key-events-2026-10-10.pptx')
    expect(blob.type).toBe(PPTX_TYPE)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('[Content_Types].xml')).toBeTruthy()
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    // Title, overview, highlights, one timeline slide (3 events in 3 years), upcoming (TETON-2, 2027-03), sources:
    // six slides, so no contents slide and (without branches) no journey map.
    expect(slides).toHaveLength(6)
    const xml = (n: number) => zip.file(`ppt/slides/slide${n}.xml`)!.async('string')
    const cover = await xml(1)
    expect(cover).toContain('Treprostinil — Asset journey')
    expect(cover).toContain('United Therapeutics')
    expect(cover).toContain('Key events · Oldest first · Filters: None')
    expect(await xml(2)).toContain('Indications covered')
    expect(await xml(2)).toMatch(/Events by category.*Regulatory 1 · Clinical 2.*Events by significance.*High 2 · Medium 1.*Events by year.*2002–2027 · busiest 2002 \(1\)/s)
    // The overview charts are native (editable) bar charts with the counts as their series values.
    const chartFiles = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    expect(chartFiles).toHaveLength(3)
    const charts = await Promise.all(chartFiles.map((f) => zip.file(f)!.async('string')))
    const series = (x: string) => ({
      labels: [...x.matchAll(/<c:cat>.*?<\/c:cat>/gs)].flatMap((m) => [...m[0].matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((v) => v[1])),
      values: [...x.matchAll(/<c:val>.*?<\/c:val>/gs)].flatMap((m) => [...m[0].matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((v) => Number(v[1]))),
    })
    // Horizontal bars list bottom-up, so the first item reads on top.
    expect(series(charts[0]!)).toEqual({ labels: ['Clinical', 'Regulatory'], values: [2, 1] })
    expect(charts[0]).toContain('<c:barDir val="bar"/>')
    expect(series(charts[1]!)).toEqual({ labels: ['Medium', 'High'], values: [1, 2] })
    const years = series(charts[2]!)
    expect(charts[2]).toContain('<c:barDir val="col"/>')
    expect(years.labels).toHaveLength(26)
    expect(years.values.reduce((a, b) => a + b, 0)).toBe(3)
    expect(years.labels.slice(0, 1).concat(years.labels.slice(-1))).toEqual(['2002', '2027'])
    expect(yearCounts([ev('x', '2001-01-01'), ev('y', '2003-05'), ev('z', '2003')])).toEqual([['2001', 1], ['2002', 0], ['2003', 2]])
    expect(await xml(3)).toMatch(/KEY HIGHLIGHTS.*name="highlight a".*name="highlight b"/s)
    const timeline = await xml(4)
    expect(timeline).toContain('Timeline · 2002–2027')
    expect(timeline).toContain('FDA approves Remodulin, &quot;first&quot; PAH therapy, for Sàrl')
    // Significance badges, category dots, indication badges (the spanned branch too) and the legend.
    expect(timeline.match(/name="sig-pill"/g)).toHaveLength(3)
    expect(timeline).toMatch(/>PH-ILD<.*>PAH</s)
    expect(timeline).toContain('Larger dot = High')
    expect(await xml(5)).toMatch(/Upcoming milestones.*in 5 months.*TETON-2 readout; topline/s)
    expect(await xml(6)).toMatch(/SOURCES &amp; METHOD.*Data sources.*3 source records behind the 3 events/s)
    // The master carries the wordmark and the deck's name; every slide but the cover its page n / N.
    const layouts = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async('string')))
    expect(layouts.some((l) => l.includes('PharmaEdge') && l.includes('Treprostinil journey · Key events'))).toBe(true)
    expect(cover).not.toContain('1 / 6')
    for (let i = 2; i <= 6; i++) expect(await xml(i)).toContain(`>${i} / 6<`)
  })

  it('adds contents, the journey map and the analytics slides in order, with notes, links and a rail row per event', async () => {
    const zip = await JSZip.loadAsync(await (await buildPptx(ctx({ branches: BRANCHES, analytics: ANALYTICS }))).arrayBuffer())
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    expect(slides).toHaveLength(12)
    const xml = (n: number) => zip.file(`ppt/slides/slide${n}.xml`)!.async('string')
    const kickers = ['CONTENTS', 'OVERVIEW', 'KEY HIGHLIGHTS', 'JOURNEY MAP', 'ANALYTICS · PIPELINE', 'ANALYTICS · APPROVALS', 'ANALYTICS · TRIALS', 'ANALYTICS · LANDSCAPE', 'TIMELINE · PART 1 OF 1', 'UPCOMING MILESTONES', 'SOURCES &amp; METHOD']
    for (const [i, k] of kickers.entries()) expect(await xml(i + 2)).toContain(`>${k}<`)
    // Contents: each section with its first slide, linked.
    const contents = await xml(2)
    expect(contents).toMatch(/>05<.*>Journey map<.*>10<.*>Timeline</s)
    expect(contents.match(/action="ppaction:\/\/hlinksldjump"/g)).toHaveLength(10)
    // Journey map: trunk first, then branches by start; a branch without events here last.
    const map = await xml(5)
    expect(map).toMatch(/>PAH<.*Trunk · since 2002 · 3 events · 2002-05-21 → 2027-03.*>PH-ILD<.*from PAH · since 2017 · 1 event.*Approved · US.*>CLI<.*No events in this export.*Closed · terminated/s)
    expect(map.match(/name="map-node /g)).toHaveLength(3)
    // Analytics: pipeline bars, approvals with regions, trials by phase (Phase 1 first), the landscape grid.
    expect(await xml(6)).toMatch(/name="pipeline-bar PAH".*>Approved<.*name="pipeline-bar CLI".*>Phase 2 · terminated</s)
    expect(await xml(7)).toMatch(/>PAH<.*>US<.*>EU<.*>PH-ILD</s)
    expect(await xml(8)).toMatch(/name="trial-bar NCT2".*name="trial-bar NCT1"/s)
    expect(await xml(9)).toMatch(/>Treprostinil<.*>Approved<.*>Rival<.*>In trials<.*>Other<.*>—</s)
    // Timeline: one rail dot per event row, in the journey's order; lanes, the fork and lane labels.
    const timeline = await xml(10)
    const ids = (re: RegExp) => [...timeline.matchAll(re)].map((m) => m[1])
    expect(ids(/name="rail-dot ([^"]+)"/g)).toEqual(['a', 'b', 'c'])
    expect(ids(/name="row-title ([^"]+)"/g)).toEqual(['a', 'b', 'c'])
    expect(ids(/name="rail-lane ([^"]+)"/g)).toEqual(['PAH', 'PH-ILD'])
    expect(ids(/name="rail-fork ([^"]+)"/g)).toEqual(['PH-ILD'])
    expect(ids(/name="rail-label ([^"]+)"/g)).toEqual(['PAH', 'PH-ILD'])
    // Each title links to its event in the app.
    const rels = await zip.file('ppt/slides/_rels/slide10.xml.rels')!.async('string')
    for (const id of ['a', 'b', 'c']) expect(rels).toContain(`Target="https://pharmaedge.test/journey/treprostinil?focus=${id}" TargetMode="External"`)
    // Speaker notes: summary, why it matters, sources (URLs as such) and the link, per event.
    const notes = await zip.file('ppt/notesSlides/notesSlide10.xml')!.async('string')
    expect(notes).toContain('2002-05-21 — FDA approves Remodulin')
    expect(notes).toContain('Why it matters: First prostacyclin by infusion.')
    expect(notes).toContain('Sources: fda_records:NDA021272')
    expect(notes).toContain('Sources: articles: https://example.com/increase; trial_records:NCT02630316')
    expect(notes).toContain('Open in PharmaEdge: https://pharmaedge.test/journey/treprostinil?focus=c')
    expect(await xml(12)).toContain('Analytics tab')

    // Newest first: the rail and rows follow the order.
    const newest = await JSZip.loadAsync(await (await buildPptx(ctx({ branches: BRANCHES, order: 'newest', events: [...EVENTS].reverse() }))).arrayBuffer())
    // Cover, contents, overview, highlights, map, then the timeline.
    const t = await newest.file('ppt/slides/slide6.xml')!.async('string')
    expect(t).toContain('Timeline · 2027–2002')
    expect([...t.matchAll(/name="rail-dot ([^"]+)"/g)].map((m) => m[1])).toEqual(['c', 'b', 'a'])
  })

  it('highlights the selected branch on the journey map, narrows the analytics to it, and says when the analytics failed', async () => {
    const branched = ctx({ branches: BRANCHES, analytics: ANALYTICS, filters: { cats: [], mine: null, branch: 'PH-ILD' }, events: [EVENTS[1]!], unbranched: EVENTS })
    const zip = await JSZip.loadAsync(await (await buildPptx(branched)).arrayBuffer())
    const all = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async('string')))
    const map = all.find((x) => x.includes('>JOURNEY MAP<'))!
    expect(map).toContain('selected branch: PH-ILD')
    // Counts on the map come from the events before the branch filter.
    expect(map).toContain('3 events')
    const pipeline = all.find((x) => x.includes('>ANALYTICS · PIPELINE<'))!
    expect(pipeline).toContain('name="pipeline-bar PH-ILD"')
    expect(pipeline).not.toContain('name="pipeline-bar PAH"')

    const failed = await JSZip.loadAsync(await (await buildPptx(ctx({ analytics: null }))).arrayBuffer())
    const texts = await Promise.all(Object.keys(failed.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => failed.file(f)!.async('string')))
    expect(texts.some((x) => x.includes('>ANALYTICS'))).toBe(false)
    expect(texts.some((x) => x.includes('could not be loaded at export time'))).toBe(true)
  })

  it('reads countdowns and picks the key highlights', () => {
    expect(countdown('2027-03', '2026-10-10')).toBe('in 5 months')
    expect(countdown('2026-10', '2026-10-10')).toBe('this month')
    expect(countdown('2026-10-24', '2026-10-10')).toBe('in 14 days')
    expect(countdown('2029', '2026-10-10')).toBe('in 2.2 years')
    const list = [ev('old', '2001-01-01'), ev('mid', '2010-01-01', { key: true }), ev('low', '2020-01-01', { significance: 'Low' }), ev('new', '2024-01-01'), ev('ahead', '2030-01', { is_milestone: true })]
    // Already happened, key first then the most recent, listed in the deck's order.
    expect(keyHighlights(list, '2026-10-10', 2).map((e) => e.id)).toEqual(['mid', 'new'])
  })

  it('pages a long journey into "(cont.)" slides, notes a long timeline, and leaves out the upcoming slide when nothing is ahead', async () => {
    const title = (i: number) => `Event ${i} `.repeat(30)
    const many = Array.from({ length: 30 }, (_, i) => ev(`e${i}`, '2020-06-01', { title: title(i) }))
    const zip = await JSZip.loadAsync(await (await buildPptx(ctx({ scope: 'all', events: many }))).arrayBuffer())
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    // Cover, contents, overview, highlights, 4 timeline slides (9 events each after the year row), sources.
    expect(slides).toHaveLength(9)
    const second = await zip.file('ppt/slides/slide6.xml')!.async('string')
    expect(second).toContain('Timeline · 2020 (cont.)')
    expect(second).toContain(`>${clip(title(9), 92)}<`)
    expect(clip(title(9), 92)).toMatch(/^(Event 9 ){10}Event 9…$/)

    const long = Array.from({ length: (LONG_TIMELINE + 1) * 9 }, (_, i) => ev(`l${i}`, '2021-01-01'))
    const deck = await JSZip.loadAsync(await (await buildPptx(ctx({ scope: 'all', events: long }))).arrayBuffer())
    expect(await deck.file('ppt/slides/slide2.xml')!.async('string')).toContain(`The timeline runs to ${LONG_TIMELINE + 1} slides`)
  }, 30_000)

  it('lists upcoming expected milestones as an iCalendar file', async () => {
    expect(upcomingMilestones(EVENTS, '2026-10-10').map((e) => e.id)).toEqual(['c'])
    expect(upcomingMilestones([ev('m', '2026-10', { is_milestone: true })], '2026-10-10')).toHaveLength(1)
    const ics = toIcs(ctx())
    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20270301\r\nDTEND;VALUE=DATE:20270302\r\n')
    expect(ics).toContain('SUMMARY:Treprostinil: TETON-2 readout\\; topline\r\n')
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true)
    const { filename, blob } = await buildExport('ics', ctx())
    expect(filename).toBe('treprostinil-journey-key-events-2026-10-10.ics')
    expect(blob.type).toBe('text/calendar;charset=utf-8')
  })
})
