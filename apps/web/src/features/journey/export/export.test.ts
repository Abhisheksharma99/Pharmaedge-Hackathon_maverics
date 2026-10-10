import ExcelJS from 'exceljs'
import { filterJourney } from '../journey-model'
import type { JourneyEventV3 } from '../types'
import { buildExport } from './build'
import { csvField, toCsv } from './csv'
import { toIcs } from './ics'
import { toJson } from './json'
import { COLUMNS, exportFileName, filtersLabel, upcomingMilestones, type ExportContext } from './model'
import { buildPdf, pdfText } from './pdf'
import { buildXlsx } from './xlsx'

const ev = (id: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch: 'PAH', type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})

const EVENTS = [
  ev('a', '2002-05-21', { title: 'FDA approves Remodulin, "first" PAH therapy, for Sàrl', summary: 'Line one\nline two', impact: 'First prostacyclin by infusion.', sources: [{ collection: 'fda_records', record_key: 'NDA021272' }] }),
  ev('b', '2017-02', { category: 'clinical', type: 'trial_start', branch: 'PH-ILD', span: ['PAH'], title: '=INCREASE trial starts', sources: [{ collection: 'articles', record_key: 'https://example.com/increase' }], merged_sources: [{ collection: 'articles', record_key: 'https://example.com/increase' }, { collection: 'trial_records', record_key: 'NCT02630316' }] }),
  ev('c', '2027-03', { is_milestone: true, category: 'clinical', branch: undefined, indications: ['Idiopathic pulmonary fibrosis (IPF)'], title: 'TETON-2 readout; topline', significance: 'Medium' }),
]

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
