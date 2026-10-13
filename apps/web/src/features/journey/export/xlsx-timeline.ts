import type { BorderStyle, Borders, Cell, Workbook, Worksheet } from 'exceljs'
import { indicationName, shortIndication } from '@/features/assets/components/competitors/utils'
import { BRANCH_PALETTE, CATEGORY_META } from '../constants'
import { eventIndications } from '../indications'
import { branchModel, byDate, laneOf, type BranchModel } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { eventLink, exportDay, filtersLabel, isoDate, SCOPE_LABEL, type ExportContext } from './model'

/** Spans longer than this many calendar years get one column per quarter instead of per month. */
export const QUARTER_SPAN = 25

export interface TimelineLane {
  id: string
  label: string
  full: string
  color: string
  /** Column index (0 = the first bucket) → its events, oldest first. */
  cells: Map<number, JourneyEventV3[]>
}

export interface TimelineGrid {
  bucket: 'month' | 'quarter'
  /** Buckets per year: 12 or 4. */
  per: number
  /** First and last calendar year shown (whole years, the export day included). */
  y0: number
  y1: number
  /** Bucket of the export day. */
  today: number
  /** Trunk, then the indication branches, then team notes; only lanes with events. */
  lanes: TimelineLane[]
  /** Events placed on the grid (dated ones). */
  placed: number
}

export const NOTES_LANE = { id: 'notes', label: 'Team notes', full: 'Notes the team added', color: '#7a5af8' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SIG_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 }

const yearMonth = (date: string): [number, number] | null => {
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(isoDate(date))
  return m ? [Number(m[1]), Number(m[2] ?? 1)] : null
}

/** A branch's full name: the branch doc's, a known abbreviation's, or an event's enrichment indication that shortens to it. */
function fullName(id: string, events: JourneyEventV3[]): string {
  if (indicationName(id)) return indicationName(id)!
  for (const e of events) for (const name of e.indications ?? []) if (name !== id && shortIndication(name) === id) return name
  return ''
}

/**
 * The lanes the app draws: the asset's branch docs when the export has them, else the events' own branches, ordered by
 * their first event (the first is the trunk) and coloured from the branch palette.
 */
function laneModel(events: JourneyEventV3[], branches: Branch[] | null | undefined): BranchModel {
  if (branches) return branchModel(branches)
  const ids = [...new Set(events.map((e) => e.branch).filter((b): b is string => !!b))]
  return branchModel(
    ids.map((id, i) => ({ id, label: id, full: '', color: BRANCH_PALETTE[i % BRANCH_PALETTE.length]!, off: i, trunk: i === 0, status: '', origin: 'rule' as const })),
  )
}

/** The export's events on a lane × time-bucket grid (time runs left to right whatever the journey's order). */
export function timelineGrid(events: JourneyEventV3[], today: string, branches?: Branch[] | null): TimelineGrid {
  const dated = events.filter((e) => yearMonth(e.date)).sort(byDate)
  const [ty, tm] = yearMonth(today)!
  let y0 = ty
  let y1 = ty
  for (const e of dated) {
    const y = yearMonth(e.date)![0]
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  const bucket = y1 - y0 + 1 > QUARTER_SPAN ? 'quarter' : 'month'
  const per = bucket === 'month' ? 12 : 4
  const at = (y: number, m: number) => (y - y0) * per + (per === 12 ? m - 1 : Math.floor((m - 1) / 3))

  const model = laneModel(dated, branches)
  const lanes = new Map<string, TimelineLane>()
  for (const b of [model.trunk, ...model.list.filter((b) => b !== model.trunk)]) {
    lanes.set(b.id, { id: b.id, label: b.label || 'Journey', full: b.full || fullName(b.id, dated), color: b.color, cells: new Map() })
  }
  lanes.set(NOTES_LANE.id, { ...NOTES_LANE, cells: new Map() })
  for (const e of dated) {
    const lane = lanes.get(e.via === 'user' ? NOTES_LANE.id : laneOf(e, model))!
    const [y, m] = yearMonth(e.date)!
    const c = at(y, m)
    lane.cells.set(c, [...(lane.cells.get(c) ?? []), e])
  }
  return { bucket, per, y0, y1, today: at(ty, tm), lanes: [...lanes.values()].filter((l) => l.cells.size > 0), placed: dated.length }
}

// ── Sheet ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const INK = '#101828'
const MUTED = '#667085'
const LINE = '#d0d5dd'
const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`
const fill = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: argb(hex) } })
/** `hex` at `a` opacity over white. */
function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(255 - (255 - v) * a).toString(16).padStart(2, '0')
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const allSides = (style: BorderStyle, hex: string): Partial<Borders> => {
  const side = { style, color: { argb: argb(hex) } }
  return { top: side, left: side, bottom: side, right: side }
}

/** Header rows above the lanes, and the frozen label columns (stripe, lane, full name). */
const HEAD = 5
const LABELS = 3
const NOTE_W = 340
const LANE_ROW_PX = 27

/** A note's box: grid cell (0-based, as the VML stores it) → size in columns/rows from the cell, and in px. */
export type NoteBoxes = Map<string, { cols: number; rows: number; w: number; h: number }>

function bucketLabel(g: TimelineGrid, c: number): string {
  const y = g.y0 + Math.floor(c / g.per)
  return g.per === 12 ? `${MONTHS[c % 12]} ${y}` : `Q${(c % 4) + 1} ${y}`
}

/** A cell's events, the most significant first (ties: oldest), for its fill. */
const lead = (events: JourneyEventV3[]) => [...events].sort((a, b) => (SIG_RANK[b.significance] ?? 0) - (SIG_RANK[a.significance] ?? 0))[0]!

function noteFor(g: TimelineGrid, c: number, events: JourneyEventV3[]): { texts: { text: string; font?: { bold?: boolean; size?: number; color?: { argb: string } } }[]; lines: number } {
  const MAX = 12
  const texts: { text: string; font?: { bold?: boolean; size?: number; color?: { argb: string } } }[] = []
  let lines = 0
  const add = (text: string, font?: (typeof texts)[number]['font']) => {
    texts.push({ text, font: { size: 9, ...font } })
    lines += text.split('\n').length - 1
  }
  if (events.length > 1) add(`${events.length} events · ${bucketLabel(g, c)}\n\n`, { bold: true })
  events.slice(0, MAX).forEach((e, i) => {
    add(`${e.title}\n`, { bold: true })
    lines += Math.floor(e.title.length / 52)
    const cat = CATEGORY_META[e.category]?.label ?? e.category
    add([isoDate(e.date), cat, e.is_milestone && 'Expected', e.significance && `${e.significance} significance`].filter(Boolean).join(' · ') + '\n', { color: { argb: argb(MUTED) } })
    const ind = eventIndications(e)
    if (ind.length) add(`Indications: ${ind.join(', ')}\n`, { color: { argb: argb(MUTED) } })
    if (i < Math.min(events.length, MAX) - 1) add('\n')
  })
  if (events.length > MAX) add(`\n…and ${events.length - MAX} more on the Journey sheet\n`, { color: { argb: argb(MUTED) } })
  if (events.length > 1) add('\nThe link opens the first event.', { color: { argb: argb(MUTED) } })
  return { texts, lines: lines + 1 }
}

/**
 * The "Timeline" sheet: the journey's horizontal track as a scrollable grid. One row per lane (trunk, indication
 * branches, team notes) with a colour stripe, label and full name frozen on the left; one narrow column per month (per
 * quarter past `QUARTER_SPAN` years) under a frozen year band; each event cell filled with its category colour (expected
 * events lighter with a dashed outline, High significance outlined in ink), a note listing its events and a link to the
 * first one. Returns the grid and the note boxes (`sizeNotes` widens them after writing).
 */
export function addTimelineSheet(wb: Workbook, ctx: ExportContext, branches?: Branch[] | null): { grid: TimelineGrid; notes: NoteBoxes } {
  const g = timelineGrid(ctx.events, exportDay(ctx.exportedAt), branches)
  const n = (g.y1 - g.y0 + 1) * g.per
  const first = LABELS + 1
  const width = g.per === 12 ? 3 : 3.6
  const colPx = Math.floor(width * 7 + 5)
  const ws: Worksheet = wb.addWorksheet('Timeline', {
    views: [{ state: 'frozen', xSplit: LABELS, ySplit: HEAD, zoomScale: 100, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 0, fitToHeight: 1, printTitlesRow: `4:${HEAD}`, printTitlesColumn: 'A:C' },
  })
  const fullWidth = Math.min(42, Math.max(14, ...g.lanes.map((l) => l.full.length + 2)))
  ws.getColumn(1).width = 1.6
  ws.getColumn(2).width = 12
  ws.getColumn(3).width = fullWidth
  for (let c = 0; c < n; c++) ws.getColumn(first + c).width = width

  // Title, what was exported, legend.
  const title = ws.getCell(1, 2)
  title.value = `${ctx.asset.name} · journey timeline`
  title.font = { bold: true, size: 13 }
  ws.getCell(1, first).value = 'Hover a coloured cell for its events; click it to open the event in PharmaEdge. Scroll right for later years.'
  ws.getCell(2, 2).value = `${SCOPE_LABEL[ctx.scope]} · one column per ${g.bucket}`
  ws.getCell(2, first).value = `Filters: ${filtersLabel(ctx.filters)} · ${g.placed} event${g.placed === 1 ? '' : 's'} · ${g.y0}–${g.y1}`
  for (const r of [1, 2]) ws.getCell(r, first).font = { size: 9, color: { argb: argb(MUTED) } }
  ws.getCell(2, 2).font = { size: 9, color: { argb: argb(MUTED) } }
  ws.getCell(3, 2).value = 'Legend'
  ws.getCell(3, 2).font = { size: 9, bold: true, color: { argb: argb(MUTED) } }
  const span = g.per === 12 ? 6 : 5
  const chip = (i: number, text: string, bg: string, color: string, border?: Partial<Borders>) => {
    const c0 = first + i * (span + 1)
    ws.mergeCells(3, c0, 3, c0 + span - 1)
    const cell = ws.getCell(3, c0)
    cell.value = text
    cell.font = { size: 8, bold: true, color: { argb: argb(color) } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    for (let c = c0; c < c0 + span; c++) {
      ws.getCell(3, c).fill = fill(bg)
      if (border) ws.getCell(3, c).border = { top: border.top, bottom: border.bottom, ...(c === c0 && { left: border.left }), ...(c === c0 + span - 1 && { right: border.right }) }
    }
  }
  const cats = Object.values(CATEGORY_META)
  cats.forEach((m, i) => chip(i, m.label, m.color, '#ffffff'))
  chip(cats.length, '● Expected', '#f2f4f7', '#475467', allSides('dashed', '#475467'))
  chip(cats.length + 1, '● High', '#ffffff', INK, allSides('medium', INK))
  chip(cats.length + 2, '×3 = 3 events', '#ffffff', INK, allSides('thin', LINE))
  chip(cats.length + 3, 'Today', INK, '#ffffff')

  // Year band and bucket labels.
  ws.getCell(HEAD, 2).value = 'Lane'
  ws.getCell(HEAD, 3).value = 'Indication'
  for (const c of [2, 3]) ws.getCell(HEAD, c).font = { size: 9, bold: true, color: { argb: argb(MUTED) } }
  const yearStart = (c: number) => c % g.per === 0
  for (let y = g.y0; y <= g.y1; y++) {
    const c0 = first + (y - g.y0) * g.per
    const bg = (y - g.y0) % 2 ? '#e4e7ec' : '#f2f4f7'
    ws.mergeCells(4, c0, 4, c0 + g.per - 1)
    const cell = ws.getCell(4, c0)
    cell.value = y
    cell.numFmt = '0'
    cell.font = { size: 9, bold: true, color: { argb: argb(INK) } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    for (let c = c0; c < c0 + g.per; c++) {
      ws.getCell(4, c).fill = fill(bg)
      const label = ws.getCell(HEAD, c)
      const i = c - first
      label.value = g.per === 12 ? MONTHS[i % 12]![0] : `Q${(i % 4) + 1}`
      label.font = { size: 8, color: { argb: argb(MUTED) } }
      label.fill = fill(bg)
      label.alignment = { horizontal: 'center', vertical: 'middle' }
      if (yearStart(i)) for (const r of [4, HEAD]) ws.getCell(r, c).border = { left: { style: 'thin', color: { argb: argb(LINE) } } }
    }
  }
  const todayHead = ws.getCell(HEAD, first + g.today)
  todayHead.fill = fill(INK)
  todayHead.font = { size: 8, bold: true, color: { argb: 'FFFFFFFF' } }
  todayHead.note = { texts: [{ text: `Today · ${exportDay(ctx.exportedAt)}`, font: { size: 9, bold: true } }] }
  const notes: NoteBoxes = new Map([[`${HEAD - 1},${first + g.today - 1}`, { cols: Math.ceil(140 / colPx), rows: 2, w: 140, h: 30 }]])
  for (const [r, h] of [[1, 22], [2, 16], [3, 18], [4, 16], [HEAD, 15]] as const) ws.getRow(r).height = h

  // Lanes.
  g.lanes.forEach((lane, li) => {
    const r = HEAD + 1 + li
    const row = ws.getRow(r)
    row.height = 20
    ws.getCell(r, 1).fill = fill(lane.color)
    const label = ws.getCell(r, 2)
    label.value = lane.label
    label.font = { bold: true, size: 10, color: { argb: argb(INK) } }
    const full = ws.getCell(r, 3)
    full.value = clip(lane.full, fullWidth - 1)
    full.font = { size: 9, color: { argb: argb(MUTED) } }
    for (const c of [2, 3]) ws.getCell(r, c).alignment = { vertical: 'middle' }
    const bg = fill(tint(lane.color, 0.08))
    const sep = { style: 'thin' as const, color: { argb: 'FFFFFFFF' } }
    for (let i = 0; i < n; i++) {
      const cell = ws.getCell(r, first + i)
      const events = lane.cells.get(i)
      if (events) {
        const lines = eventCell(cell, g, i, events, ctx)
        const h = lines * 14 + 16
        notes.set(`${r - 1},${first + i - 1}`, { cols: Math.ceil(NOTE_W / colPx), rows: Math.ceil(h / LANE_ROW_PX), w: NOTE_W, h })
        continue
      }
      cell.fill = bg
      const dash = { style: 'dashed' as const, color: { argb: argb(INK) } }
      cell.border =
        i === g.today ? { left: dash, right: dash, bottom: sep } : { bottom: sep, ...(yearStart(i) && { left: { style: 'thin', color: { argb: argb(LINE) } } }) }
    }
  })
  if (!g.lanes.length) ws.getCell(HEAD + 1, 2).value = 'No dated events in this export.'
  return { grid: g, notes }
}

/** Styles an event cell and gives it its note; returns the note's line count. */
function eventCell(cell: Cell, g: TimelineGrid, c: number, events: JourneyEventV3[], ctx: ExportContext): number {
  const top = lead(events)
  const meta = CATEGORY_META[top.category] ?? { color: '#667085', soft: '#f2f4f7' }
  const expected = events.every((e) => e.is_milestone)
  const high = events.some((e) => e.significance === 'High')
  const firstEvent = events[0]!
  cell.value = {
    text: events.length === 1 ? '●' : `×${events.length}`,
    hyperlink: eventLink(ctx, firstEvent),
    tooltip: clip(events.length === 1 ? firstEvent.title : `${events.length} events · first: ${firstEvent.title}`, 250),
  }
  cell.fill = fill(expected ? meta.soft : meta.color)
  cell.font = { bold: true, size: 8, color: { argb: expected ? argb(meta.color) : 'FFFFFFFF' } }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
  cell.border = expected ? allSides(high ? 'mediumDashed' : 'dashed', meta.color) : high ? allSides('medium', INK) : allSides('thin', '#ffffff')
  const note = noteFor(g, c, events)
  cell.note = { texts: note.texts }
  return note.lines
}

/**
 * ExcelJS gives every note a 2-column × 4-row box, a sliver on the timeline's narrow columns. Rewrites each Timeline
 * note's VML anchor (and shape size) in the written workbook to `notes`' boxes.
 */
export async function sizeNotes(buf: ArrayBuffer, notes: NoteBoxes): Promise<ArrayBuffer> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buf)
  for (const file of zip.file(/^xl\/drawings\/vmlDrawing\d+\.vml$/)) {
    const vml = await file.async('string')
    const sized = vml.replace(/<v:shape\b[\s\S]*?<\/v:shape>/g, (shape) => {
      const row = /<x:Row>(\d+)<\/x:Row>/.exec(shape)?.[1]
      const col = /<x:Column>(\d+)<\/x:Column>/.exec(shape)?.[1]
      const box = notes.get(`${row},${col}`)
      if (!box) return shape
      const l = Number(col) + 1
      const t = Math.max(Number(row) - 1, 0)
      return shape
        .replace(/width:[\d.]+pt;height:[\d.]+pt/, `width:${(box.w * 0.75).toFixed(1)}pt;height:${(box.h * 0.75).toFixed(1)}pt`)
        .replace(/<x:Anchor>[^<]*<\/x:Anchor>/, `<x:Anchor>${[l, 6, t, 4, l + box.cols, 0, t + box.rows, 0].join(', ')}</x:Anchor>`)
    })
    if (sized !== vml) zip.file(file.name, sized)
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
