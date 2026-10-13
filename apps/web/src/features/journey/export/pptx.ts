import type PptxGenJS from 'pptxgenjs'
import { CATEGORIES, CATEGORY_META } from '../constants'
import { eventIndications } from '../indications'
import type { JourneyEventV3 } from '../types'
import { exportDay, filtersLabel, isoDate, ORDER_LABEL, SCOPE_LABEL, upcomingMilestones, type ExportContext } from './model'

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** Table lines per timeline slide, year rows included. */
export const ROWS_PER_SLIDE = 12

/** 16:9 "widescreen" slide, inches. */
const W = 13.333
const H = 7.5
const M = 0.5
const FONT = 'Arial'
const C = { primary: '2347D9', text: '101828', body: '344054', muted: '667085', border: 'E4E7EC', band: 'F2F4F7', white: 'FFFFFF' }
const SIGNIFICANCE = ['High', 'Medium', 'Low'] as const
const SIGNIFICANCE_COLORS = ['2347D9', '7A93EC', 'B4C2F3', 'D0D5DD']
const hex = (color: string) => color.replace('#', '').toUpperCase()
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Text cut at a word boundary to `max` characters, with an ellipsis. */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`
}

/** A timeline table line: a year row, or one event. */
export type TimelineLine = { year: string; cont: boolean } | { event: JourneyEventV3 }

/**
 * The events split into slide tables, in the journey's order: a year row before each year's events, repeated as
 * "(cont.)" on a slide that carries on a year, and never left as a slide's last line.
 */
export function timelinePages(events: JourneyEventV3[], per = ROWS_PER_SLIDE): TimelineLine[][] {
  const pages: TimelineLine[][] = []
  let page: TimelineLine[] = []
  let year = ''
  for (const event of events) {
    const y = isoDate(event.date).slice(0, 4)
    const starts = y !== year
    if (page.length + (starts ? 2 : 1) > per) {
      pages.push(page)
      page = []
    }
    if (starts || page.length === 0) page.push({ year: y, cont: !starts })
    year = y
    page.push({ event })
  }
  if (page.length) pages.push(page)
  return pages
}

/** "2002–2027" from the earliest and latest event, "2017" for one year, "" without events. */
function dateSpan(events: JourneyEventV3[]): string {
  const years = events.map((e) => isoDate(e.date).slice(0, 4)).sort()
  const [first, last] = [years[0], years[years.length - 1]]
  return !first ? '' : first === last ? first : `${first}–${last}`
}

/** Events per year from the first year to the last, empty years included: `[["2002", 1], ["2003", 0], …]`. */
export function yearCounts(events: JourneyEventV3[]): [string, number][] {
  const byYear = new Map<number, number>()
  for (const e of events) {
    const y = Number(isoDate(e.date).slice(0, 4))
    if (Number.isFinite(y)) byYear.set(y, (byYear.get(y) ?? 0) + 1)
  }
  if (!byYear.size) return []
  const first = Math.min(...byYear.keys())
  return Array.from({ length: Math.max(...byYear.keys()) - first + 1 }, (_, i) => [String(first + i), byYear.get(first + i) ?? 0])
}

/** Shown indications, most events first. */
function indicationCounts(events: JourneyEventV3[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const e of events) for (const i of eventIndications(e)) counts.set(i, (counts.get(i) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/**
 * The shown events as a 16:9 deck: a title slide, an overview (key numbers, events by category, significance and
 * year as native, editable bar charts), the timeline as year-grouped tables, the upcoming expected milestones, and a footer with
 * the page number on every slide. pptxgenjs is loaded on demand.
 */
export async function buildPptx(ctx: ExportContext): Promise<Blob> {
  const mod = await import('pptxgenjs')
  const Pptx = (mod as unknown as { default?: typeof PptxGenJS }).default ?? (mod as unknown as typeof PptxGenJS)
  const pptx = new Pptx()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = `${ctx.asset.name} — Asset journey`
  pptx.subject = 'Asset journey export'
  pptx.author = 'PharmaEdge'
  pptx.company = 'PharmaEdge'
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT }

  const n = ctx.events.length
  const today = exportDay(ctx.exportedAt)
  const upcoming = upcomingMilestones(ctx.events, today)
  const footer = `PharmaEdge · ${ctx.asset.name} journey`
  const context = `${SCOPE_LABEL[ctx.scope]} · ${ORDER_LABEL[ctx.order]} · Filters: ${filtersLabel(ctx.filters)}`
  let page = 0

  const addSlide = (title?: string, subtitle?: string) => {
    const slide = pptx.addSlide()
    slide.background = { color: C.white }
    page++
    slide.addText(`${footer} · page ${page}`, { x: M, y: H - 0.45, w: W - 2 * M, h: 0.3, fontFace: FONT, fontSize: 9, color: C.muted, margin: 0 })
    if (title) {
      slide.addShape(pptx.ShapeType.rect, { x: M, y: 0.42, w: 0.08, h: 0.46, fill: { color: C.primary }, line: { color: C.primary, width: 0 } })
      slide.addText(title, { x: M + 0.2, y: 0.36, w: W - 2 * M - 0.2, h: 0.58, fontFace: FONT, fontSize: 24, bold: true, color: C.text, margin: 0, valign: 'middle' })
    }
    if (subtitle) slide.addText(subtitle, { x: M + 0.2, y: 0.94, w: W - 2 * M - 0.2, h: 0.3, fontFace: FONT, fontSize: 11, color: C.muted, margin: 0 })
    return slide
  }

  // Title
  const cover = addSlide()
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.primary }, line: { color: C.primary, width: 0 } })
  cover.addText('PHARMAEDGE · ASSET JOURNEY EXPORT', { x: 1, y: 1.6, w: W - 2, h: 0.35, fontFace: FONT, fontSize: 12, bold: true, color: C.primary, charSpacing: 1.5, margin: 0 })
  cover.addText(`${ctx.asset.name} — Asset journey`, { x: 1, y: 2.05, w: W - 2, h: 1.0, fontFace: FONT, fontSize: 40, bold: true, color: C.text, margin: 0, valign: 'top', fit: 'shrink' })
  if (ctx.asset.company) cover.addText(ctx.asset.company, { x: 1, y: 3.1, w: W - 2, h: 0.5, fontFace: FONT, fontSize: 20, color: C.body, margin: 0 })
  cover.addShape(pptx.ShapeType.line, { x: 1, y: 4.15, w: 3, h: 0, line: { color: C.border, width: 1 } })
  cover.addText(
    [
      { text: `Exported ${ctx.exportedAt.toLocaleDateString(undefined, { dateStyle: 'long' })}`, options: { breakLine: true } },
      { text: context, options: { breakLine: true } },
      { text: `${plural(n, 'event')}${dateSpan(ctx.events) ? ` · ${dateSpan(ctx.events)}` : ''}`, options: { bold: true, color: C.text } },
    ],
    { x: 1, y: 4.35, w: W - 2, h: 1.3, fontFace: FONT, fontSize: 14, color: C.body, margin: 0, valign: 'top', paraSpaceAfter: 6 },
  )

  // Overview: key numbers, then events by category, significance and year.
  const overview = addSlide('Overview', context)
  const indications = indicationCounts(ctx.events)
  const tiles: [string, string, string][] = [
    ['Events', String(n), SCOPE_LABEL[ctx.scope]],
    ['Date span', dateSpan(ctx.events) || '—', `${new Set(ctx.events.map((e) => isoDate(e.date).slice(0, 4))).size} years with events`],
    ['Indications covered', String(indications.length), clip(indications.map(([i]) => i).join(', ') || 'None tagged', 48)],
    ['Upcoming milestones', String(upcoming.length), upcoming.length ? `Next: ${upcoming.map((e) => isoDate(e.date)).sort()[0]}` : 'None expected ahead'],
  ]
  const tileW = (W - 2 * M - 3 * 0.25) / 4
  tiles.forEach(([label, value, note], i) => {
    const x = M + i * (tileW + 0.25)
    overview.addShape(pptx.ShapeType.roundRect, { x, y: 1.45, w: tileW, h: 1.2, fill: { color: C.white }, line: { color: C.border, width: 1 }, rectRadius: 0.08 })
    overview.addText(
      [
        { text: label, options: { fontSize: 11, color: C.muted, breakLine: true } },
        { text: value, options: { fontSize: 26, bold: true, color: C.text, breakLine: true } },
        { text: note, options: { fontSize: 10, color: C.muted } },
      ],
      { x: x + 0.18, y: 1.53, w: tileW - 0.36, h: 1.04, fontFace: FONT, margin: 0, valign: 'middle' },
    )
  })

  // Native charts, editable in PowerPoint, Keynote and Google Slides (previews such as Quick Look may draw them blank),
  // each with a one-line text summary under its title that any viewer shows.
  const chartHead = (title: string, summary: string, x: number, y: number, w: number) => {
    overview.addText(title, { x, y, w, h: 0.28, fontFace: FONT, fontSize: 12, bold: true, color: C.text, margin: 0 })
    overview.addText(summary, { x, y: y + 0.28, w, h: 0.24, fontFace: FONT, fontSize: 9.5, color: C.muted, margin: 0, fit: 'shrink' })
  }
  const axes = {
    fontFace: FONT,
    catAxisLabelFontFace: FONT,
    catAxisLabelFontSize: 10,
    catAxisLabelColor: C.body,
    catAxisLineShow: true,
    catGridLine: { style: 'none' as const },
    valAxisLabelFontFace: FONT,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: C.muted,
    valAxisLabelFormatCode: '0',
    valAxisMinVal: 0,
    valGridLine: { color: C.border, size: 0.5 },
    showLegend: false,
    dataLabelFontFace: FONT,
    dataLabelFontSize: 9,
    dataLabelColor: C.text,
    dataLabelFormatCode: '0',
    dataLabelPosition: 'outEnd' as const,
  }
  /** Labelled horizontal bars, the count after each bar, first item on top. */
  const hbars = (title: string, y: number, items: { label: string; value: number; color: string }[]) => {
    chartHead(title, items.map((i) => `${i.label} ${i.value}`).join(' · ') || 'No events', M, y, 4.6)
    if (!items.length) return
    // A bar chart draws its first category at the bottom: reversed, the list reads top-down.
    const rev = [...items].reverse()
    overview.addChart(pptx.ChartType.bar, [{ name: title, labels: rev.map((i) => i.label), values: rev.map((i) => i.value) }], {
      ...axes,
      x: M,
      y: y + 0.5,
      w: 4.6,
      h: 1.4,
      barDir: 'bar',
      barGapWidthPct: 45,
      chartColors: rev.map((i) => i.color),
      valAxisHidden: true,
      valGridLine: { style: 'none' },
      showValue: true,
    })
  }

  hbars(
    'Events by category',
    3.0,
    CATEGORIES.map((c) => ({ label: CATEGORY_META[c].label, value: ctx.events.filter((e) => e.category === c).length, color: hex(CATEGORY_META[c].color) })).filter((i) => i.value > 0),
  )
  const unrated = ctx.events.filter((e) => !(SIGNIFICANCE as readonly string[]).includes(e.significance)).length
  hbars(
    'Events by significance',
    4.95,
    [...SIGNIFICANCE.map((s, i) => ({ label: s as string, value: ctx.events.filter((e) => e.significance === s).length, color: SIGNIFICANCE_COLORS[i]! })), { label: 'Unrated', value: unrated, color: SIGNIFICANCE_COLORS[3]! }].filter((i) => i.value > 0),
  )

  // Columns for every year from the first to the last, gaps included, so the axis reads as time.
  const byYear = yearCounts(ctx.events)
  const cx = M + 5.1
  const cw = W - M - cx
  const busiest = byYear.reduce<[string, number] | null>((b, y) => (!b || y[1] > b[1] ? y : b), null)
  chartHead('Events by year', busiest ? `${byYear[0]![0]}–${byYear[byYear.length - 1]![0]} · busiest ${busiest[0]} (${busiest[1]})` : 'No events', cx, 3.0, cw)
  if (byYear.length) {
    const max = busiest![1]
    overview.addChart(pptx.ChartType.bar, [{ name: 'Events by year', labels: byYear.map(([y]) => y), values: byYear.map(([, v]) => v) }], {
      ...axes,
      x: cx,
      y: 3.5,
      w: cw,
      h: 3.35,
      barDir: 'col',
      barGapWidthPct: 40,
      chartColors: [C.primary],
      catAxisLabelFontSize: 9,
      catAxisLabelColor: C.muted,
      catAxisLabelFrequency: String(Math.ceil(byYear.length / 12)),
      valAxisMajorUnit: Math.max(1, Math.ceil(max / 5)),
      showValue: byYear.length <= 24,
    })
  }

  // Timeline (and upcoming milestones): year-grouped tables.
  const COL_W = [1.35, 5.6, 1.6, 1.25, W - 2 * M - 9.8]
  const head = ['Date', 'Title', 'Category', 'Significance', 'Indications'].map((text) => ({
    text,
    options: { bold: true, color: C.white, fill: { color: C.primary }, fontSize: 10.5 },
  }))
  const eventRow = (e: JourneyEventV3) => {
    const meta = CATEGORY_META[e.category]
    const ind = eventIndications(e)
    return [
      { text: e.is_milestone ? [{ text: isoDate(e.date) }, { text: '  expected', options: { color: C.primary, italic: true, fontSize: 9 } }] : isoDate(e.date) },
      { text: clip(e.title, 110), options: { color: C.text } },
      { text: [{ text: '● ', options: { color: hex(meta?.color ?? '#98a2b3') } }, { text: meta?.label ?? e.category }] },
      { text: e.significance ?? '', options: { bold: e.significance === 'High' } },
      { text: ind.length > 3 ? `${ind.slice(0, 3).join(', ')} +${ind.length - 3}` : ind.join(', ') },
    ]
  }
  const addTables = (title: string, events: JourneyEventV3[], subtitle: string) => {
    for (const lines of timelinePages(events)) {
      const first = lines[0] as { year: string; cont: boolean }
      const yearsOn = lines.flatMap((l) => ('year' in l ? [l.year] : []))
      const span = yearsOn.length > 1 ? `${yearsOn[0]}–${yearsOn[yearsOn.length - 1]}` : yearsOn[0]
      const slide = addSlide(`${title} · ${span}${first.cont ? ' (cont.)' : ''}`, subtitle)
      const rows = lines.map((l) =>
        'year' in l
          ? [{ text: l.cont ? `${l.year} (cont.)` : l.year, options: { colspan: 5, bold: true, color: C.text, fill: { color: C.band }, fontSize: 10.5 } }]
          : eventRow(l.event),
      )
      slide.addTable([head, ...rows], {
        x: M,
        y: 1.4,
        w: W - 2 * M,
        colW: COL_W,
        rowH: [0.36, ...lines.map((l) => ('year' in l ? 0.3 : 0.42))],
        fontFace: FONT,
        fontSize: 10,
        color: C.body,
        valign: 'middle',
        margin: [0.04, 0.1, 0.04, 0.1],
        border: { type: 'solid', pt: 0.5, color: C.border },
        autoPage: false,
      })
    }
  }

  addTables('Timeline', ctx.events, `${plural(n, 'event')} · ${ORDER_LABEL[ctx.order].toLowerCase()}`)
  if (upcoming.length) addTables('Upcoming milestones', upcoming, `${plural(upcoming.length, 'expected milestone')} ahead as of ${today}`)

  const buf = (await pptx.write({ outputType: 'arraybuffer', compression: true })) as ArrayBuffer
  return new Blob([buf], { type: PPTX_TYPE })
}
