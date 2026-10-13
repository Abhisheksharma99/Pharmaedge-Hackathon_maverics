import type PptxGenJS from 'pptxgenjs'
import { approvedIndications } from '@/features/analytics/approved'
import { statusLabel } from '@/features/analytics/card-filter-defs'
import { phaseColor, phaseTag, sortTrialsByPhase } from '@/features/analytics/trial-phase'
import { indicationName, shortIndication } from '@/features/assets/components/competitors/utils'
import { relativeFuture } from '@/lib/dates'
import { CATEGORIES, CATEGORY_META, collectionMeta, STAGES } from '../constants'
import { eventIndications } from '../indications'
import { branchModel, inBranch, type BranchModel } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { eventLink, eventSources, exportDay, filtersLabel, isoDate, ORDER_LABEL, SCOPE_LABEL, sourceUrl, summaryText, upcomingMilestones, type ExportContext } from './model'
import { pageRail, railLanes, ROW_H, timelinePages, type PageRail, type TimelineLine } from './pptx-timeline'

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** Past this many timeline slides the contents slide suggests filtering; past the cap the timeline stops (CSV and Excel hold every event). */
export const LONG_TIMELINE = 60
export const TIMELINE_SLIDE_CAP = 400
/** Expected milestones per "Upcoming milestones" slide. */
export const UPCOMING_PER_SLIDE = 7
/** Trials per "Clinical trials by phase" slide, and at most this many slides of them. */
export const TRIALS_PER_SLIDE = 14
export const TRIAL_SLIDE_CAP = 3

/** 16:9 "widescreen" slide, inches. */
const W = 13.333
const H = 7.5
const M = 0.5
/** Content top, under the slide header. */
const TOP = 1.45
const FONT = 'Arial'
const C = {
  primary: '2347D9',
  primarySoft: 'EEF2FD',
  text: '101828',
  body: '344054',
  muted: '667085',
  faint: '98A2B3',
  border: 'E4E7EC',
  band: 'F2F4F7',
  white: 'FFFFFF',
  warn: 'B54708',
  warnSoft: 'FFFAEB',
}
const SIGNIFICANCE = ['High', 'Medium', 'Low'] as const
const SIGNIFICANCE_COLORS = ['2347D9', '7A93EC', 'B4C2F3', 'D0D5DD']
/** Significance badges: High red-soft, Medium amber-soft, Low grey. */
const SIG_PILL: Record<string, { fill: string; color: string }> = {
  High: { fill: 'FEE4E2', color: 'B42318' },
  Medium: { fill: 'FEF0C7', color: 'B54708' },
  Low: { fill: 'F2F4F7', color: '475467' },
}
const NO_LINE = { type: 'none' as const }
const hex = (color: string) => color.replace('#', '').toUpperCase()
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const branchCount = (n: number) => `${n} indication branch${n === 1 ? '' : 'es'}`
const catColor = (e: JourneyEventV3) => hex(CATEGORY_META[e.category]?.color ?? '#98a2b3')
const catLabel = (e: JourneyEventV3) => CATEGORY_META[e.category]?.label ?? e.category
/** Rough Arial text width, inches (for badge widths and label staggering). */
const textW = (s: string, pt: number, bold = false) => s.length * pt * (bold ? 0.0081 : 0.0074)

/** Text cut at a word boundary to `max` characters, with an ellipsis. */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`
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
 * The "Key highlights": up to `n` High-significance events that already happened (expected ones have their own slide;
 * only when there are none of those), key events first, then the most recent; listed in the deck's order.
 */
export function keyHighlights(events: JourneyEventV3[], today: string, n = 6): JourneyEventV3[] {
  const high = events.filter((e) => e.significance === 'High')
  const past = high.filter((e) => isoDate(e.date) <= today)
  const pool = past.length ? past : high
  const picked = new Set([...pool].sort((a, b) => Number(!!b.key) - Number(!!a.key) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, n))
  return events.filter((e) => picked.has(e))
}

/** Countdown to an expected milestone: "in 12 days", "in 5 months", "in 1.4 years", or "this month" / "this year" for one due in the current period. */
export function countdown(date: string, today: string): string {
  const d = isoDate(date)
  if (d.length < 10 && d === today.slice(0, d.length)) return d.length === 4 ? 'this year' : 'this month'
  const r = relativeFuture(d, today)
  return !r || r.endsWith('ago') ? 'due now' : r
}

/** The events by branch for the journey map, trunk first and then in the order the branches started (branches without events last). */
export function journeyMapRows(model: BranchModel, events: JourneyEventV3[]): { branch: Branch; events: JourneyEventV3[]; first: string; last: string }[] {
  const rows = model.list.map((branch) => {
    const mine = events.filter((e) => inBranch(e, branch.id, model)).map((e) => isoDate(e.date)).sort()
    return { branch, events: events.filter((e) => inBranch(e, branch.id, model)), first: mine[0] ?? '', last: mine[mine.length - 1] ?? '' }
  })
  const key = (r: (typeof rows)[number]) => (r.branch.trunk ? '' : r.first || '\uffff')
  return rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.branch.off - b.branch.off))
}

/** A presenter's note per event: date, title, facts, summary and why it matters, sources (URLs when they have one), link. */
function eventNote(ctx: ExportContext, e: JourneyEventV3): string {
  const facts = [catLabel(e), e.significance, eventIndications(e).join(', '), e.is_milestone ? 'expected' : ''].filter(Boolean).join(' · ')
  const sources = eventSources(e).map((s) => (sourceUrl(s) ? `${s.collection}: ${sourceUrl(s)}` : `${s.collection}:${s.record_key}`))
  return [
    `${isoDate(e.date)} — ${e.title}${facts ? ` (${facts})` : ''}`,
    summaryText(e),
    sources.length ? `Sources: ${sources.join('; ')}` : 'Sources: none cited',
    `Open in PharmaEdge: ${eventLink(ctx, e)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The shown events as a 16:9 deck on a "PharmaEdge" master (footer wordmark, page n / N): a title slide, contents
 * (longer decks), an overview (key numbers; events by category, significance and year as native, editable bar
 * charts), the journey map (the branch structure as a vertical tree), key highlights, the timeline (a vertical rail
 * echoing the app's tree beside year-grouped tables, events linked to the app, summaries and sources in the speaker
 * notes), the upcoming expected milestones with countdowns, and sources & method. Everything is native shapes and
 * text, so PowerPoint, Keynote and Google Slides draw it alike. pptxgenjs is loaded on demand.
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
  const newestFirst = ctx.order === 'newest'
  const model = branchModel(ctx.branches)
  const focus = ctx.filters.branch ?? null
  const upcoming = upcomingMilestones(ctx.events, today)
  const highlights = keyHighlights(ctx.events, today)
  const context = `${SCOPE_LABEL[ctx.scope]} · ${ORDER_LABEL[ctx.order]} · Filters: ${filtersLabel(ctx.filters)}`
  const allPages = timelinePages(ctx.events)
  const pages = allPages.slice(0, TIMELINE_SLIDE_CAP)
  const left = pages.length < allPages.length ? n - pages.flat().filter((l) => 'event' in l).length : 0
  const upcomingPages = Array.from({ length: Math.ceil(upcoming.length / UPCOMING_PER_SLIDE) }, (_, i) => upcoming.slice(i * UPCOMING_PER_SLIDE, (i + 1) * UPCOMING_PER_SLIDE))

  // Analytics blocks, narrowed to the selected branch or indication.
  const a = ctx.analytics
  const key = focus ?? ctx.filters.ind ?? null
  const matches = (label: string) => !key || label === key
  const pipeline = (a?.pipeline ?? []).filter((r) => matches(r.label))
  const approved = a ? approvedIndications(a, []).filter((r) => matches(r.indication)) : []
  const trialsAll = (a?.trials ?? []).filter((t) => matches(shortIndication(t.indication || '')))
  // Long trial lists keep the active trials, then the most recent; the slides list them by phase.
  const trialsShown = sortTrialsByPhase(
    [...trialsAll].sort((x, y) => Number(y.active) - Number(x.active) || (y.start || '').localeCompare(x.start || '')).slice(0, TRIALS_PER_SLIDE * TRIAL_SLIDE_CAP),
  )
  const trialPages = Array.from({ length: Math.ceil(trialsShown.length / TRIALS_PER_SLIDE) }, (_, i) => trialsShown.slice(i * TRIALS_PER_SLIDE, (i + 1) * TRIALS_PER_SLIDE))
  const landCols = (a?.landscape.cols ?? []).filter((c) => matches(shortIndication(c)))
  const landscape = a && a.landscape.rows.length >= 2 && landCols.length ? { cols: landCols, rows: a.landscape.rows } : null

  // The plan first, so the contents slide and every footer know the slide numbers.
  const parts: { id: 'overview' | 'highlights' | 'map' | 'pipeline' | 'approved' | 'trials' | 'landscape' | 'timeline' | 'upcoming' | 'sources'; title: string; note: string; count: number }[] = [
    { id: 'overview', title: 'Overview', note: 'Key numbers and events by category, significance and year', count: 1 },
    { id: 'highlights', title: 'Key highlights', note: `${plural(highlights.length, 'high-significance event')}`, count: highlights.length ? 1 : 0 },
    { id: 'map', title: 'Journey map', note: `${branchCount(model.list.length)}, as the journey forked`, count: model.multi ? 1 : 0 },
    { id: 'pipeline', title: 'Development pipeline', note: 'Furthest stage per indication', count: pipeline.length ? 1 : 0 },
    { id: 'approved', title: 'Approved indications', note: `${plural(approved.length, 'approved indication')} and their regions`, count: approved.length ? 1 : 0 },
    { id: 'trials', title: 'Clinical trials by phase', note: `${plural(trialsAll.length, 'trial')}, Phase 1 → 4`, count: trialPages.length },
    { id: 'landscape', title: 'Competitive landscape', note: `${plural(landscape?.rows.length ?? 0, 'asset')} by indication`, count: landscape ? 1 : 0 },
    { id: 'timeline', title: 'Timeline', note: `${plural(n, 'event')}${dateSpan(ctx.events) ? `, ${dateSpan(ctx.events)}` : ''} · ${ORDER_LABEL[ctx.order].toLowerCase()}`, count: pages.length },
    { id: 'upcoming', title: 'Upcoming milestones', note: `${plural(upcoming.length, 'expected milestone')} ahead`, count: upcomingPages.length },
    { id: 'sources', title: 'Sources & method', note: 'Scope, filters and the records behind the events', count: 1 },
  ]
  const base = 1 + parts.reduce((s, p) => s + p.count, 0)
  const withContents = base > 6
  const total = base + (withContents ? 1 : 0)
  const startOf = {} as Record<(typeof parts)[number]['id'], number>
  parts.reduce((at, p) => ((startOf[p.id] = at), at + p.count), withContents ? 3 : 2)

  pptx.defineSlideMaster({
    title: 'PE',
    background: { color: C.white },
    objects: [
      { line: { x: M, y: 6.98, w: W - 2 * M, h: 0, line: { color: C.border, width: 0.75 } } },
      { rect: { x: M, y: 7.12, w: 0.15, h: 0.15, fill: { color: C.primary }, line: NO_LINE } },
      { text: { text: 'PharmaEdge', options: { x: M + 0.22, y: 7.06, w: 1.2, h: 0.27, fontFace: FONT, fontSize: 10, bold: true, color: C.text, margin: 0, valign: 'middle' } } },
      { text: { text: `${ctx.asset.name} journey · ${SCOPE_LABEL[ctx.scope]}`, options: { x: M + 1.4, y: 7.06, w: 7, h: 0.27, fontFace: FONT, fontSize: 9, color: C.muted, margin: 0, valign: 'middle' } } },
    ],
  })

  const slides: PptxGenJS.Slide[] = []
  /** A content slide: kicker, title with an accent bar, optional subtitle. */
  const addSlide = (kicker: string, title: string, subtitle?: string) => {
    const slide = pptx.addSlide({ masterName: 'PE' })
    slides.push(slide)
    slide.addShape(pptx.ShapeType.rect, { x: M, y: 0.4, w: 0.07, h: 0.62, fill: { color: C.primary }, line: NO_LINE })
    slide.addText(kicker.toUpperCase(), { x: M + 0.2, y: 0.36, w: W - 2 * M - 0.2, h: 0.22, fontFace: FONT, fontSize: 9, bold: true, color: C.primary, charSpacing: 1, margin: 0 })
    slide.addText(title, { x: M + 0.2, y: 0.58, w: W - 2 * M - 0.2, h: 0.46, fontFace: FONT, fontSize: 22, bold: true, color: C.text, margin: 0, valign: 'middle', fit: 'shrink' })
    if (subtitle) slide.addText(subtitle, { x: M + 0.2, y: 1.06, w: W - 2 * M - 0.2, h: 0.26, fontFace: FONT, fontSize: 10.5, color: C.muted, margin: 0 })
    return slide
  }
  /** Primary-soft indication badges from `x`, as many as fit in `maxW` ("+N" for the rest); returns the right edge. */
  const badges = (slide: PptxGenJS.Slide, labels: string[], x: number, y: number, maxW: number, h = 0.22) => {
    let at = x
    labels.forEach((label, i) => {
      const rest = labels.length - i - 1
      const w = textW(label, 8, true) + 0.18
      const more = rest ? textW(`+${rest}`, 8, true) + 0.24 : 0
      if (at < 0 || at + w + more > x + maxW) {
        if (at >= 0) {
          slide.addText(`+${labels.length - i}`, { x: at, y, w: textW(`+${labels.length - i}`, 8, true) + 0.18, h, fontFace: FONT, fontSize: 8, bold: true, color: C.muted, margin: 0, align: 'center', valign: 'middle' })
          at = -1
        }
        return
      }
      slide.addText(label, { shape: pptx.ShapeType.roundRect, rectRadius: h / 2, x: at, y, w, h, fill: { color: C.primarySoft }, line: NO_LINE, fontFace: FONT, fontSize: 8, bold: true, color: C.primary, margin: 0, align: 'center', valign: 'middle' })
      at += w + 0.06
    })
    return at
  }

  // Title
  const cover = pptx.addSlide()
  slides.push(cover)
  cover.background = { color: C.white }
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.primary }, line: NO_LINE })
  cover.addShape(pptx.ShapeType.rect, { x: 1, y: 0.82, w: 0.22, h: 0.22, fill: { color: C.primary }, line: NO_LINE })
  cover.addText('PharmaEdge', { x: 1.32, y: 0.78, w: 3, h: 0.3, fontFace: FONT, fontSize: 15, bold: true, color: C.text, margin: 0, valign: 'middle' })
  cover.addText('ASSET JOURNEY EXPORT', { x: 1, y: 1.75, w: W - 2, h: 0.35, fontFace: FONT, fontSize: 12, bold: true, color: C.primary, charSpacing: 1.5, margin: 0 })
  cover.addText(`${ctx.asset.name} — Asset journey`, { x: 1, y: 2.15, w: W - 2, h: 1.0, fontFace: FONT, fontSize: 40, bold: true, color: C.text, margin: 0, valign: 'top', fit: 'shrink' })
  if (ctx.asset.company) cover.addText(ctx.asset.company, { x: 1, y: 3.2, w: W - 2, h: 0.5, fontFace: FONT, fontSize: 20, color: C.body, margin: 0 })
  cover.addShape(pptx.ShapeType.line, { x: 1, y: 4.2, w: 3, h: 0, line: { color: C.border, width: 1 } })
  const branchesShown = model.multi ? new Set(ctx.events.flatMap((e) => model.list.filter((b) => inBranch(e, b.id, model)).map((b) => b.id))).size : 0
  cover.addText(
    [
      { text: `Exported ${ctx.exportedAt.toLocaleDateString(undefined, { dateStyle: 'long' })}`, options: { breakLine: true } },
      { text: context, options: { breakLine: true } },
      {
        text: `${plural(n, 'event')}${dateSpan(ctx.events) ? ` · ${dateSpan(ctx.events)}` : ''}${branchesShown ? ` · ${branchCount(branchesShown)}` : ''}`,
        options: { bold: true, color: C.text },
      },
    ],
    { x: 1, y: 4.4, w: W - 2, h: 1.3, fontFace: FONT, fontSize: 14, color: C.body, margin: 0, valign: 'top', paraSpaceAfter: 6 },
  )

  // Contents, with each section linked to its first slide.
  if (withContents) {
    const slide = addSlide('Contents', `${ctx.asset.name} journey`, `${total} slides · ${context}`)
    const shown = parts.filter((p) => p.count > 0)
    const rowH = Math.min(0.78, 5.2 / shown.length)
    shown.forEach((p, i) => {
      const y = TOP + 0.05 + i * rowH
      const to = startOf[p.id]
      slide.addText(String(to).padStart(2, '0'), { x: M + 0.2, y, w: 0.8, h: rowH - 0.12, fontFace: FONT, fontSize: 22, bold: true, color: C.primary, margin: 0, valign: 'middle' })
      slide.addText(
        [
          { text: p.title, options: { bold: true, fontSize: rowH < 0.6 ? 13 : 15, color: C.text, breakLine: true } },
          { text: `${p.note}${p.count > 1 ? ` · slides ${to}–${to + p.count - 1}` : ''}`, options: { fontSize: 10.5, color: C.muted } },
        ],
        { x: M + 1.1, y, w: 6.2, h: rowH - 0.12, fontFace: FONT, margin: 0, valign: 'middle' },
      )
      slide.addShape(pptx.ShapeType.line, { x: M + 0.2, y: y + rowH - 0.06, w: 7.1, h: 0, line: { color: C.border, width: 0.75 } })
      // The whole entry jumps to its section: a clear shape on top carries the link (a linked run would be underlined).
      slide.addShape(pptx.ShapeType.rect, { x: M + 0.2, y, w: 7.1, h: rowH - 0.12, fill: { color: C.white, transparency: 100 }, line: NO_LINE, hyperlink: { slide: to, tooltip: `Go to ${p.title}` }, objectName: `contents-link ${p.id}` })
    })
    // About this deck, and a note when the timeline is long.
    const ax = 8.6
    slide.addShape(pptx.ShapeType.roundRect, { x: ax, y: TOP + 0.05, w: W - M - ax, h: 1.75, fill: { color: C.band }, line: NO_LINE, rectRadius: 0.1 })
    slide.addText(
      [
        { text: 'About this deck', options: { bold: true, fontSize: 12, color: C.text, breakLine: true } },
        { text: `${plural(n, 'event')} the journey shows: ${SCOPE_LABEL[ctx.scope].toLowerCase()}, ${ORDER_LABEL[ctx.order].toLowerCase()}.`, options: { breakLine: true } },
        { text: `Filters: ${filtersLabel(ctx.filters)}.`, options: { breakLine: true } },
        { text: 'Event titles link to the event in PharmaEdge; the speaker notes carry each event’s summary and sources.' },
      ],
      { x: ax + 0.2, y: TOP + 0.2, w: W - M - ax - 0.4, h: 1.5, fontFace: FONT, fontSize: 10.5, color: C.body, margin: 0, valign: 'top', paraSpaceAfter: 6 },
    )
    if (pages.length > LONG_TIMELINE || left) {
      slide.addText(
        left
          ? `The timeline stops after ${TIMELINE_SLIDE_CAP} slides: ${plural(left, 'later event')} ${left === 1 ? 'is' : 'are'} left out. Filter by branch, category or indication for a full deck, or export CSV or Excel for every event.`
          : `The timeline runs to ${pages.length} slides. For a shorter deck, filter the journey by branch, category or indication (or use Key events) before exporting.`,
        { shape: pptx.ShapeType.roundRect, rectRadius: 0.1, x: ax, y: TOP + 2.0, w: W - M - ax, h: 1.25, fill: { color: C.warnSoft }, line: { color: 'FEDF89', width: 0.75 }, fontFace: FONT, fontSize: 10.5, color: C.warn, margin: 10, valign: 'middle' },
      )
    }
  }

  // Overview: key numbers, then events by category, significance and year.
  const overview = addSlide('Overview', 'At a glance', context)
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
    overview.addShape(pptx.ShapeType.roundRect, { x, y: TOP + 0.05, w: tileW, h: 1.2, fill: { color: C.white }, line: { color: C.border, width: 1 }, rectRadius: 0.08 })
    overview.addText(
      [
        { text: label, options: { fontSize: 11, color: C.muted, breakLine: true } },
        { text: value, options: { fontSize: 26, bold: true, color: C.text, breakLine: true } },
        { text: note, options: { fontSize: 10, color: C.muted } },
      ],
      { x: x + 0.18, y: TOP + 0.13, w: tileW - 0.36, h: 1.04, fontFace: FONT, margin: 0, valign: 'middle' },
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

  // Key highlights: the high-significance events as cards.
  if (highlights.length) {
    const slide = addSlide('Key highlights', 'High-significance events', `${plural(highlights.length, 'event')} rated High${highlights.length < ctx.events.filter((e) => e.significance === 'High').length ? ', key and most recent first' : ''} · ${ORDER_LABEL[ctx.order].toLowerCase()}`)
    const cols = 3
    const gx = 0.25
    const cw = (W - 2 * M - (cols - 1) * gx) / cols
    const ch = 2.55
    highlights.forEach((e, i) => {
      const x = M + (i % cols) * (cw + gx)
      const y = TOP + 0.05 + Math.floor(i / cols) * (ch + 0.2)
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: C.white }, line: { color: C.border, width: 0.75 }, rectRadius: 0.08, objectName: `highlight ${e.id}` })
      slide.addShape(pptx.ShapeType.rect, { x, y: y + 0.12, w: 0.06, h: ch - 0.24, fill: { color: catColor(e) }, line: NO_LINE })
      slide.addText(
        [
          { text: '● ', options: { color: catColor(e) } },
          { text: `${catLabel(e)} · ${isoDate(e.date)}${e.is_milestone ? ' · expected' : ''}`, options: { color: C.muted } },
        ],
        { x: x + 0.22, y: y + 0.14, w: cw - 0.4, h: 0.24, fontFace: FONT, fontSize: 9.5, bold: true, margin: 0, valign: 'middle' },
      )
      slide.addText([{ text: clip(e.title, 100), options: { hyperlink: { url: eventLink(ctx, e), tooltip: 'Open this event in PharmaEdge' }, color: C.text } }], {
        x: x + 0.22, y: y + 0.42, w: cw - 0.4, h: 0.9, fontFace: FONT, fontSize: 13, bold: true, margin: 0, valign: 'top', fit: 'shrink',
      })
      badges(slide, eventIndications(e), x + 0.22, y + 1.38, cw - 0.4)
      const impact = (e.impact || e.summary || '').trim()
      if (impact) slide.addText(clip(impact, 150), { x: x + 0.22, y: y + 1.7, w: cw - 0.4, h: 0.72, fontFace: FONT, fontSize: 9.5, color: C.body, margin: 0, valign: 'top', fit: 'shrink' })
    })
    slide.addNotes(highlights.map((e) => eventNote(ctx, e)).join('\n\n'))
  }

  // Journey map: the branch structure as a vertical tree, branch cards beside it.
  if (model.multi) {
    const rows = journeyMapRows(model, ctx.unbranched ?? ctx.events)
    const focused = focus ? model.byId.get(focus) : undefined
    const slide = addSlide(
      'Journey map',
      `${ctx.asset.name}: ${branchCount(rows.length)}`,
      `Trunk ${model.trunk.label || model.trunk.id}; each new indication forks off the programme that led to it, in the order it started${focused ? ` · selected branch: ${focused.label}` : ''}`,
    )
    const rowH = Math.min(0.5, (6.85 - TOP) / rows.length)
    const two = rowH >= 0.4
    const sorted = [...model.list].sort((a, b) => a.off - b.off)
    const gap = sorted.length > 1 ? Math.min(0.42, 2.5 / (sorted.length - 1)) : 0
    const laneX = new Map(sorted.map((b, k) => [b.id, 1.25 + 1.25 - ((sorted.length - 1) * gap) / 2 + k * gap]))
    const cardX = 4.15
    const yc = (i: number) => TOP + i * rowH + rowH / 2
    const bottom = TOP + rows.length * rowH - 0.05
    const dim = (id: string) => (focus && focus !== id ? 65 : rows.find((r) => r.branch.id === id)!.events.length ? 0 : 60)
    rows.forEach((r, i) => {
      const b = r.branch
      const x = laneX.get(b.id)!
      const y = yc(i)
      // Its lane: from the fork down to today, or to just after the latest fork before an ended branch's last event; a
      // branch without events in this export is a faint stub.
      let end = r.events.length ? bottom : y
      if (b.ended && r.last) {
        const j = rows.reduce((at, o, k) => (k >= i && o.first && o.first <= r.last ? k : at), i)
        end = j === rows.length - 1 ? bottom : yc(j) + rowH * 0.45
      }
      const parent = b.trunk ? null : laneX.get(b.from && model.byId.has(b.from) ? b.from : model.trunk.id)!
      const elbow = y - Math.min(0.18, rowH * 0.38)
      slide.addShape(pptx.ShapeType.line, { x, y: b.trunk ? y : elbow, w: 0, h: end - (b.trunk ? y : elbow), line: { color: hex(b.color), width: b.trunk ? 3 : 2.25, transparency: dim(b.id) }, objectName: `map-lane ${b.id}` })
      if (parent !== null) slide.addShape(pptx.ShapeType.line, { x: Math.min(parent, x), y: elbow, w: Math.abs(x - parent), h: 0, line: { color: hex(b.color), width: 2.25, transparency: dim(b.id) } })
      if (b.ended && r.last) {
        slide.addShape(pptx.ShapeType.ellipse, { x: x - 0.08, y: end - 0.08, w: 0.16, h: 0.16, fill: { color: C.white }, line: { color: hex(b.color), width: 1.25 } })
        slide.addShape(pptx.ShapeType.line, { x: x - 0.035, y: end - 0.035, w: 0.07, h: 0.07, line: { color: hex(b.color), width: 1.25 } })
        slide.addShape(pptx.ShapeType.line, { x: x - 0.035, y: end - 0.035, w: 0.07, h: 0.07, flipV: true, line: { color: hex(b.color), width: 1.25 } })
      }
    })
    rows.forEach((r, i) => {
      const b = r.branch
      const x = laneX.get(b.id)!
      const y = yc(i)
      const on = focus === b.id
      const color = hex(b.color)
      slide.addText(r.first.slice(0, 4), { x: M, y: y - 0.12, w: 0.6, h: 0.24, fontFace: FONT, fontSize: 10, bold: true, color: r.first ? C.body : C.faint, margin: 0, valign: 'middle' })
      slide.addShape(pptx.ShapeType.line, { x: x + 0.08, y, w: cardX - x - 0.08, h: 0, line: { color, width: 0.75, transparency: 55, dashType: 'dash' } })
      slide.addShape(pptx.ShapeType.ellipse, { x: x - 0.08, y: y - 0.08, w: 0.16, h: 0.16, fill: { color: b.trunk ? color : C.white }, line: { color, width: 2 }, objectName: `map-node ${b.id}` })
      const cy = y - rowH / 2 + 0.03
      const ch = rowH - 0.06
      slide.addShape(pptx.ShapeType.roundRect, {
        x: cardX, y: cy, w: W - M - cardX, h: ch, rectRadius: 0.06,
        fill: { color: on ? color : C.white, transparency: on ? 92 : 0 },
        line: { color: on ? color : C.border, width: on ? 1.75 : 0.75 },
        objectName: `map-card ${b.id}`,
      })
      slide.addShape(pptx.ShapeType.rect, { x: cardX, y: cy + 0.06, w: 0.05, h: ch - 0.12, fill: { color }, line: NO_LINE })
      const facts = [
        b.trunk ? 'Trunk' : `from ${model.byId.get(b.from ?? '')?.label ?? model.trunk.label}`,
        r.first ? `since ${r.first.slice(0, 4)}` : '',
        r.events.length ? plural(r.events.length, 'event') : 'No events in this export',
        r.first ? `${r.first} → ${r.last}` : '',
      ].filter(Boolean).join(' · ')
      const muted = !r.events.length
      slide.addText(
        [
          { text: b.label, options: { bold: true, fontSize: 11, color: muted ? C.faint : color } },
          { text: `   ${clip(b.full, two ? 80 : 50)}`, options: { fontSize: 10, color: muted ? C.faint : C.text, breakLine: two } },
          ...(two ? [{ text: facts, options: { fontSize: 9, color: C.muted } }] : []),
        ],
        { x: cardX + 0.18, y: cy, w: 5.9, h: ch, fontFace: FONT, margin: 0, valign: 'middle' },
      )
      slide.addText(two ? b.status || '—' : `${b.status || '—'} · ${r.events.length}`, {
        x: cardX + 6.15, y: cy, w: W - M - cardX - 6.3, h: ch, fontFace: FONT, fontSize: 9.5, bold: true, color: b.ended ? C.warn : muted ? C.faint : C.body, margin: 0, align: 'right', valign: 'middle', fit: 'shrink',
      })
    })
    slide.addNotes(rows.map((r) => `${r.branch.label} — ${r.branch.full}: ${r.branch.status}${r.branch.why ? `. ${r.branch.why}` : ''}`).join('\n'))
  }

  // Analytics (fetched at export time): pipeline, approved indications, trials by phase, competitive landscape.
  if (pipeline.length) {
    const slide = addSlide('Analytics · pipeline', 'Development pipeline', `Furthest stage per indication${key ? ` · ${key}` : ''} · terminated programmes in grey`)
    const lx = M
    const trackX = 3.6
    const trackW = 6.6
    const nx = trackX + trackW + 0.25
    const colW = trackW / STAGES.length
    STAGES.forEach((st, k) => {
      slide.addText(st, { x: trackX + k * colW, y: TOP, w: colW, h: 0.26, fontFace: FONT, fontSize: 8.5, bold: true, color: C.muted, margin: 0, align: 'center', valign: 'middle', charSpacing: 0.5 })
      if (k) slide.addShape(pptx.ShapeType.line, { x: trackX + k * colW, y: TOP + 0.3, w: 0, h: Math.min(0.5, 5.1 / pipeline.length) * pipeline.length, line: { color: C.border, width: 0.75, dashType: 'dash' } })
    })
    slide.addText('Next', { x: nx, y: TOP, w: W - M - nx, h: 0.26, fontFace: FONT, fontSize: 8.5, bold: true, color: C.muted, margin: 0, valign: 'middle' })
    const rowH = Math.min(0.5, 5.1 / pipeline.length)
    pipeline.forEach((r, i) => {
      const y = TOP + 0.3 + i * rowH
      const color = r.ended ? 'D0D5DD' : hex(r.color ?? model.byId.get(r.id)?.color ?? C.primary)
      const stage = STAGES[Math.min(Math.max(r.stage, 0), STAGES.length - 1)]!
      slide.addText(
        [
          { text: '● ', options: { color: hex(r.color ?? C.primary) } },
          { text: r.label, options: { bold: true, color: C.text } },
          { text: `  ${clip(r.full, 34)}`, options: { color: C.muted, fontSize: 8.5 } },
        ],
        { x: lx, y, w: trackX - lx - 0.1, h: rowH, fontFace: FONT, fontSize: 10, margin: 0, valign: 'middle' },
      )
      slide.addShape(pptx.ShapeType.roundRect, { x: trackX, y: y + 0.06, w: trackW, h: rowH - 0.12, fill: { color: 'F9FAFB' }, line: NO_LINE, rectRadius: 0.06 })
      slide.addText(r.ended ? `${stage} · ${r.ended.toLowerCase()}` : stage, {
        shape: pptx.ShapeType.roundRect, rectRadius: 0.06, x: trackX, y: y + 0.1, w: (trackW * (r.stage + 0.55)) / STAGES.length, h: rowH - 0.2,
        fill: { color }, line: NO_LINE, fontFace: FONT, fontSize: 9, bold: true, color: r.ended ? C.body : C.white, margin: [0, 8, 0, 0], align: 'right', valign: 'middle', objectName: `pipeline-bar ${r.id}`,
      })
      slide.addText(
        r.next
          ? [
              { text: clip(r.next.title.replace(/^(Phase \d readout expected|FDA decision expected \(PDUFA date\)): /, ''), 40), options: { color: C.text, breakLine: true } },
              { text: countdown(r.next.date, today), options: { color: C.primary, bold: true, fontSize: 8.5 } },
            ]
          : [{ text: r.since ? `since ${r.since.slice(0, 4)}` : '—', options: { color: C.primary, bold: true } }],
        { x: nx, y, w: W - M - nx, h: rowH, fontFace: FONT, fontSize: 9, margin: 0, valign: 'middle', fit: 'shrink' },
      )
    })
  }

  if (approved.length) {
    const slide = addSlide('Analytics · approvals', 'Approved indications', `${plural(approved.length, 'approved indication')} with the regions each is approved in`)
    const cols = 3
    const gx = 0.25
    const cw = (W - 2 * M - (cols - 1) * gx) / cols
    const ch = 1.5
    approved.forEach((r, i) => {
      const x = M + (i % cols) * (cw + gx)
      const y = TOP + 0.05 + Math.floor(i / cols) * (ch + 0.2)
      const branch = model.byId.get(r.indication)
      const color = hex(branch?.color ?? C.primary)
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: C.white }, line: { color: C.border, width: 0.75 }, rectRadius: 0.08, objectName: `approved ${r.indication}` })
      slide.addShape(pptx.ShapeType.rect, { x, y: y + 0.12, w: 0.06, h: ch - 0.24, fill: { color }, line: NO_LINE })
      slide.addText(
        [
          { text: r.indication, options: { bold: true, fontSize: 18, color, breakLine: true } },
          { text: clip(branch?.full || indicationName(r.indication) || '', 70) || ' ', options: { fontSize: 10, color: C.body } },
        ],
        { x: x + 0.22, y: y + 0.12, w: cw - 0.4, h: 0.8, fontFace: FONT, margin: 0, valign: 'top' },
      )
      slide.addText('Approved in', { x: x + 0.22, y: y + 1.0, w: 1.0, h: 0.26, fontFace: FONT, fontSize: 9, color: C.muted, margin: 0, valign: 'middle' })
      if (r.regions.length) badges(slide, r.regions, x + 1.2, y + 1.02, cw - 1.4)
      else slide.addText('Regions not recorded', { x: x + 1.2, y: y + 1.0, w: cw - 1.4, h: 0.26, fontFace: FONT, fontSize: 9, italic: true, color: C.faint, margin: 0, valign: 'middle' })
    })
  }

  trialPages.forEach((items, p) => {
    const slide = addSlide(
      trialPages.length > 1 ? `Analytics · trials · part ${p + 1} of ${trialPages.length}` : 'Analytics · trials',
      'Clinical trials by phase',
      `${trialsShown.length < trialsAll.length ? `${trialsShown.length} of ${trialsAll.length} trials (active and most recent first)` : plural(trialsAll.length, 'trial')}${key ? ` · ${key}` : ''} · Phase 1 → 4 · bars run from start to primary completion`,
    )
    const ax = 5.0
    const aw = 5.9
    const sx = ax + aw + 0.2
    const years = trialsShown.flatMap((t) => [t.start, t.pcd]).filter(Boolean).map((d) => Number(d.slice(0, 4)))
    const [y0, y1] = [Math.min(...years), Math.max(...years) + 1]
    const xOf = (d: string) => ax + (aw * (Number(d.slice(0, 4)) + (Number(d.slice(5, 7) || 1) - 1) / 12 - y0)) / Math.max(1, y1 - y0)
    const rowH = 0.36
    const step = Math.max(1, Math.ceil((y1 - y0) / 8))
    for (let yr = y0; yr <= y1; yr += step) {
      const x = xOf(`${yr}`)
      slide.addText(String(yr), { x: x - 0.3, y: TOP, w: 0.6, h: 0.22, fontFace: FONT, fontSize: 8, color: C.muted, margin: 0, align: 'center' })
      slide.addShape(pptx.ShapeType.line, { x, y: TOP + 0.24, w: 0, h: items.length * rowH, line: { color: C.border, width: 0.5 } })
    }
    slide.addText('Status', { x: sx, y: TOP, w: W - M - sx, h: 0.22, fontFace: FONT, fontSize: 8, bold: true, color: C.muted, margin: 0 })
    items.forEach((t, i) => {
      const y = TOP + 0.26 + i * rowH
      const color = hex(phaseColor(t.phase))
      slide.addText(phaseTag(t.phase), { shape: pptx.ShapeType.roundRect, rectRadius: 0.1, x: M, y: y + 0.07, w: 0.5, h: 0.22, fill: { color }, line: NO_LINE, fontFace: FONT, fontSize: 8, bold: true, color: C.white, margin: 0, align: 'center', valign: 'middle' })
      slide.addText(
        [
          { text: clip(t.name || t.nct, 28), options: { bold: true, color: C.text } },
          ...(t.name && t.name !== t.nct ? [{ text: `  ${t.nct}`, options: { color: C.muted, fontSize: 8 } }] : []),
          { text: `  ${clip(shortIndication(t.indication || ''), 22)}`, options: { color: C.primary, fontSize: 8.5, bold: true } },
        ],
        { x: M + 0.6, y, w: ax - M - 0.7, h: rowH, fontFace: FONT, fontSize: 9.5, margin: 0, valign: 'middle', fit: 'shrink' },
      )
      if (t.start) {
        const x1 = xOf(t.start)
        const x2 = Math.max(x1 + 0.06, t.pcd ? xOf(t.pcd) : x1 + 0.06)
        slide.addShape(pptx.ShapeType.roundRect, { x: x1, y: y + 0.1, w: x2 - x1, h: rowH - 0.2, rectRadius: 0.05, fill: { color, transparency: t.active ? 0 : 55 }, line: NO_LINE, objectName: `trial-bar ${t.nct}` })
      }
      slide.addText(statusLabel(t.status || '—'), { x: sx, y, w: W - M - sx, h: rowH, fontFace: FONT, fontSize: 8.5, bold: t.active, color: t.active ? '067647' : C.muted, margin: 0, valign: 'middle', fit: 'shrink' })
      slide.addShape(pptx.ShapeType.line, { x: M, y: y + rowH, w: W - 2 * M, h: 0, line: { color: C.band, width: 0.5 } })
    })
  })

  if (landscape) {
    const slide = addSlide('Analytics · landscape', 'Competitive landscape', `${plural(landscape.rows.length, 'asset')} across ${plural(landscape.cols.length, 'indication')} · Approved / In trials / —`)
    const CELL = { approved: { text: 'Approved', fill: 'DCFAE6', color: '067647' }, investigational: { text: 'In trials', fill: C.primarySoft, color: C.primary }, none: { text: '—', fill: C.white, color: C.faint } }
    const firstW = 3.2
    const cw = (W - 2 * M - firstW) / landscape.cols.length
    const rows = landscape.rows.slice(0, 12)
    slide.addTable(
      [
        [{ text: 'Asset', options: { bold: true, color: C.body, fill: { color: C.band } } }, ...landscape.cols.map((c) => ({ text: shortIndication(c), options: { bold: true, color: C.body, fill: { color: C.band }, align: 'center' as const } }))],
        ...rows.map((r) => [
          { text: [{ text: r.name, options: { bold: true, color: r.me ? C.primary : C.text, breakLine: !!r.company } }, ...(r.company ? [{ text: clip(r.company, 40), options: { fontSize: 8.5, color: C.muted } }] : [])], options: { fill: { color: r.me ? C.primarySoft : C.white } } },
          ...landscape.cols.map((c) => {
            const v = CELL[r.cells[c] ?? 'none']
            return { text: v.text, options: { align: 'center' as const, bold: v.text !== '—', color: v.color, fill: { color: v.fill } } }
          }),
        ]),
      ],
      { x: M, y: TOP + 0.05, w: W - 2 * M, colW: [firstW, ...landscape.cols.map(() => cw)], fontFace: FONT, fontSize: 9.5, valign: 'middle', margin: [0.05, 0.1, 0.05, 0.1], border: { type: 'solid', pt: 0.75, color: C.white }, rowH: 0.42, autoPage: false },
    )
    if (landscape.rows.length > rows.length) slide.addText(`+ ${plural(landscape.rows.length - rows.length, 'more asset')} in the Analytics tab`, { x: M, y: 6.6, w: 6, h: 0.25, fontFace: FONT, fontSize: 9.5, color: C.muted, margin: 0 })
  }

  // Timeline: a vertical rail echoing the app's tree, beside the year-grouped event rows. The rows are positioned text
  // boxes rather than a table: viewers lay table rows out by their own text metrics (Quick Look shrinks them), which
  // would pull the rows away from their dots.
  const TX = 4.5
  const COL_W = [0.98, 3.97, 1.2, 0.98, W - M - TX - 7.13]
  const COL_X = COL_W.map((_, i) => TX + COL_W.slice(0, i).reduce((a, b) => a + b, 0))
  const lanes = railLanes(ctx.events, model, newestFirst, 1.4, 2.65)
  const indexOf = new Map(ctx.events.map((e, i) => [e, i]))
  const perYear = new Map<string, number>()
  for (const e of ctx.events) perYear.set(isoDate(e.date).slice(0, 4), (perYear.get(isoDate(e.date).slice(0, 4)) ?? 0) + 1)
  const legend = [
    ...CATEGORIES.flatMap((c) => [
      { text: '● ', options: { color: hex(CATEGORY_META[c].color) } },
      { text: `${CATEGORY_META[c].label}    `, options: {} },
    ]),
    { text: '○ ', options: { color: C.muted, bold: true } },
    { text: 'Expected    ', options: {} },
    { text: '⬤ ', options: { color: C.muted, fontSize: 10 } },
    { text: 'Larger dot = High', options: {} },
  ]
  const cell = { fontFace: FONT, fontSize: 9.5, color: C.body, margin: [6, 6, 0, 0] as [number, number, number, number], valign: 'middle' as const, h: ROW_H.event }

  const drawRail = (slide: PptxGenJS.Slide, rail: PageRail) => {
    const dim = (id: string) => (focus && focus !== id ? 65 : 0)
    // The header and year bands run across the rail and the rows.
    slide.addShape(pptx.ShapeType.rect, { x: M, y: TOP, w: W - 2 * M, h: ROW_H.head, fill: { color: C.band }, line: NO_LINE })
    ;['Date', 'Title', 'Category', 'Significance', 'Indications'].forEach((text, i) => {
      slide.addText(text, { ...cell, x: COL_X[i]!, y: TOP, w: COL_W[i]!, h: ROW_H.head, bold: true, align: i === 3 ? 'center' : 'left' })
    })
    for (const y of rail.years) {
      slide.addShape(pptx.ShapeType.rect, { x: M, y: y.y - ROW_H.year / 2, w: W - 2 * M, h: ROW_H.year, fill: { color: C.primarySoft }, line: NO_LINE })
      slide.addText(y.year, { x: M + 0.1, y: y.y - ROW_H.year / 2, w: 0.7, h: ROW_H.year, fontFace: FONT, fontSize: 10, bold: true, color: C.primary, margin: 0, valign: 'middle', objectName: `rail-year ${y.year}` })
      slide.addText(`${y.year}${y.cont ? ' (cont.)' : ''} · ${plural(perYear.get(y.year) ?? 0, 'event')}`, { ...cell, x: TX, y: y.y - ROW_H.year / 2, w: W - M - TX, h: ROW_H.year, bold: true, color: C.primary })
    }
    // Lane labels in the header strip, staggered on two lines when the lanes are close.
    if (model.multi) {
      const shown = rail.segments.map((s) => s.lane).filter((l) => l.label)
      const close = shown.some((l, k) => k > 0 && l.x - shown[k - 1]!.x < 0.62)
      shown.forEach((l, k) => {
        slide.addText(l.label, {
          x: l.x - 0.45, y: TOP + (close ? (k % 2 ? 0.165 : 0.02) : 0.06), w: 0.9, h: close ? 0.14 : 0.2,
          fontFace: FONT, fontSize: 7, bold: true, color: dim(l.id) ? C.faint : hex(l.color), margin: 0, align: 'center', valign: 'middle', objectName: `rail-label ${l.id}`,
        })
      })
    }
    if (rail.today !== null) {
      slide.addShape(pptx.ShapeType.line, { x: M + 0.62, y: rail.today, w: W - 2 * M - 0.62, h: 0, line: { color: C.text, width: 0.75, dashType: 'dash' } })
      slide.addText('Today', { x: M + 0.08, y: rail.today - 0.09, w: 0.55, h: 0.18, fontFace: FONT, fontSize: 7.5, bold: true, color: C.text, margin: 0, valign: 'middle' })
    }
    // Each dot's connector to its row (under the lanes, like the app's card connectors).
    for (const d of rail.dots) slide.addShape(pptx.ShapeType.line, { x: d.lane.x, y: d.y, w: TX - d.lane.x, h: 0, line: { color: hex(d.lane.color), width: 0.75, transparency: 55 } })
    for (const s of rail.segments) {
      slide.addShape(pptx.ShapeType.line, { x: s.lane.x, y: s.y1, w: 0, h: Math.max(0.01, s.y2 - s.y1), line: { color: hex(s.lane.color), width: s.lane.trunk ? 3 : 2, transparency: dim(s.lane.id) }, objectName: `rail-lane ${s.lane.id}` })
    }
    for (const f of rail.forks) {
      slide.addShape(pptx.ShapeType.line, { x: Math.min(f.x1, f.lane.x), y: f.y, w: Math.abs(f.lane.x - f.x1), h: 0, line: { color: hex(f.lane.color), width: 2, transparency: dim(f.lane.id) }, objectName: `rail-fork ${f.lane.id}` })
      slide.addShape(pptx.ShapeType.ellipse, { x: f.x1 - 0.05, y: f.y - 0.05, w: 0.1, h: 0.1, fill: { color: C.white }, line: { color: hex(f.lane.color), width: 1.5 } })
    }
    for (const c of rail.caps) {
      const color = hex(c.lane.color)
      slide.addShape(pptx.ShapeType.ellipse, { x: c.lane.x - 0.08, y: c.y - 0.08, w: 0.16, h: 0.16, fill: { color: C.white }, line: { color, width: 1.25 }, objectName: `rail-cap ${c.lane.id}` })
      slide.addShape(pptx.ShapeType.line, { x: c.lane.x - 0.035, y: c.y - 0.035, w: 0.07, h: 0.07, line: { color, width: 1.25 } })
      slide.addShape(pptx.ShapeType.line, { x: c.lane.x - 0.035, y: c.y - 0.035, w: 0.07, h: 0.07, flipV: true, line: { color, width: 1.25 } })
    }
    for (const d of rail.dots) {
      const color = hex(d.lane.color)
      if (d.span.length) {
        const xs = [d.lane.x, ...d.span]
        slide.addShape(pptx.ShapeType.line, { x: Math.min(...xs), y: d.y, w: Math.max(...xs) - Math.min(...xs), h: 0, line: { color, width: 1.25, dashType: 'sysDot' } })
        for (const x of d.span) slide.addShape(pptx.ShapeType.ellipse, { x: x - 0.045, y: d.y - 0.045, w: 0.09, h: 0.09, fill: { color: C.white }, line: { color, width: 1.25 } })
      }
      const s = d.e.significance === 'High' ? 0.17 : 0.13
      slide.addShape(pptx.ShapeType.ellipse, {
        x: d.lane.x - s / 2, y: d.y - s / 2, w: s, h: s,
        fill: { color: d.e.is_milestone ? C.white : catColor(d.e) },
        line: d.e.is_milestone ? { color: catColor(d.e), width: 1.5, dashType: 'sysDash' } : { color: C.white, width: 1 },
        objectName: `rail-dot ${d.e.id}`,
      })
    }
  }

  /** One event row level with its dot: date, linked title (two lines at most), category, significance badge, indication badges. */
  const eventRow = (slide: PptxGenJS.Slide, e: JourneyEventV3, y: number) => {
    const top = y - ROW_H.event / 2
    slide.addShape(pptx.ShapeType.line, { x: TX, y: top + ROW_H.event, w: W - M - TX, h: 0, line: { color: C.border, width: 0.5 } })
    slide.addText(e.is_milestone ? [{ text: isoDate(e.date), options: { breakLine: true } }, { text: 'expected', options: { color: C.primary, italic: true, fontSize: 8.5 } }] : isoDate(e.date), { ...cell, x: COL_X[0]!, y: top, w: COL_W[0]! })
    slide.addText([{ text: clip(e.title, 92), options: { hyperlink: { url: eventLink(ctx, e), tooltip: 'Open this event in PharmaEdge' }, color: C.text } }], { ...cell, x: COL_X[1]!, y: top, w: COL_W[1]!, fontSize: 10, objectName: `row-title ${e.id}` })
    slide.addText([{ text: '● ', options: { color: catColor(e) } }, { text: catLabel(e) }], { ...cell, x: COL_X[2]!, y: top, w: COL_W[2]! })
    const pill = SIG_PILL[e.significance]
    if (pill) {
      slide.addText(e.significance, { shape: pptx.ShapeType.roundRect, rectRadius: 0.12, x: COL_X[3]! + (COL_W[3]! - 0.74) / 2, y: y - 0.12, w: 0.74, h: 0.24, fill: { color: pill.fill }, line: NO_LINE, fontFace: FONT, fontSize: 8.5, bold: true, color: pill.color, margin: 0, align: 'center', valign: 'middle', objectName: 'sig-pill' })
    }
    badges(slide, eventIndications(e), COL_X[4]! + 0.08, y - 0.11, COL_W[4]! - 0.1)
  }

  pages.forEach((lines: TimelineLine[], p) => {
    const first = lines[0] as { year: string; cont: boolean }
    const yearsOn = lines.flatMap((l) => ('year' in l ? [l.year] : []))
    const span = yearsOn.length > 1 ? `${yearsOn[0]}–${yearsOn[yearsOn.length - 1]}` : yearsOn[0]
    const events = lines.flatMap((l) => ('event' in l ? [l.event] : []))
    const slide = addSlide(`Timeline · part ${p + 1} of ${pages.length}`, `Timeline · ${span}${first.cont ? ' (cont.)' : ''}`, `${plural(events.length, 'event')} on this slide · ${plural(n, 'event')} in all · ${ORDER_LABEL[ctx.order].toLowerCase()}`)
    slide.addText(legend, { x: W - M - 6.2, y: 1.06, w: 6.2, h: 0.26, fontFace: FONT, fontSize: 8.5, color: C.muted, margin: 0, align: 'right', valign: 'middle' })
    const rail = pageRail(lines, (e) => indexOf.get(e)!, lanes, model, newestFirst, TOP, today)
    drawRail(slide, rail)
    for (const d of rail.dots) eventRow(slide, d.e, d.y)
    slide.addNotes(events.map((e) => eventNote(ctx, e)).join('\n\n'))
  })

  // Upcoming milestones: a mini vertical timeline from today, each with its countdown and indications.
  upcomingPages.forEach((items, p) => {
    const slide = addSlide(
      upcomingPages.length > 1 ? `Upcoming milestones · part ${p + 1} of ${upcomingPages.length}` : 'Upcoming milestones',
      'Upcoming milestones',
      `${plural(upcoming.length, 'expected milestone')} ahead as of ${today} · ${ORDER_LABEL[ctx.order].toLowerCase()}`,
    )
    const rowH = 0.72
    const rx = M + 0.45
    // Today sits where time starts: on top oldest first, at the bottom newest first.
    const top = TOP + 0.45
    const ys = items.map((_, i) => top + i * rowH + rowH / 2 - (newestFirst ? 0.45 : 0))
    const todayY = newestFirst ? ys[ys.length - 1]! + rowH / 2 + 0.2 : TOP + 0.15
    const [y1, y2] = newestFirst ? [ys[0]!, todayY] : [todayY, ys[ys.length - 1]!]
    slide.addShape(pptx.ShapeType.line, { x: rx, y: y1, w: 0, h: y2 - y1, line: { color: C.faint, width: 2, dashType: 'dash' } })
    slide.addShape(pptx.ShapeType.ellipse, { x: rx - 0.07, y: todayY - 0.07, w: 0.14, h: 0.14, fill: { color: C.text }, line: NO_LINE })
    slide.addText(`Today · ${today}`, { x: rx + 0.2, y: todayY - 0.12, w: 3, h: 0.24, fontFace: FONT, fontSize: 9.5, bold: true, color: C.text, margin: 0, valign: 'middle' })
    items.forEach((e, i) => {
      const y = ys[i]!
      const color = catColor(e)
      slide.addShape(pptx.ShapeType.ellipse, { x: rx - 0.09, y: y - 0.09, w: 0.18, h: 0.18, fill: { color: C.white }, line: { color, width: 1.75, dashType: 'sysDash' }, objectName: `upcoming-dot ${e.id}` })
      slide.addShape(pptx.ShapeType.line, { x: rx + 0.12, y, w: 0.5, h: 0, line: { color, width: 0.75, transparency: 50 } })
      slide.addText(countdown(e.date, today), { shape: pptx.ShapeType.roundRect, rectRadius: 0.13, x: rx + 0.68, y: y - 0.26, w: 1.4, h: 0.26, fill: { color: C.primarySoft }, line: NO_LINE, fontFace: FONT, fontSize: 9.5, bold: true, color: C.primary, margin: 0, align: 'center', valign: 'middle' })
      slide.addText(isoDate(e.date), { x: rx + 0.68, y: y + 0.03, w: 1.4, h: 0.22, fontFace: FONT, fontSize: 9, color: C.muted, margin: 0, align: 'center', valign: 'middle' })
      const tx = rx + 2.3
      slide.addText([{ text: clip(e.title, 110), options: { hyperlink: { url: eventLink(ctx, e), tooltip: 'Open this event in PharmaEdge' }, color: C.text } }], { x: tx, y: y - 0.3, w: W - M - tx, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, margin: 0, valign: 'middle', fit: 'shrink' })
      slide.addText([{ text: '● ', options: { color } }, { text: `${catLabel(e)}${e.significance ? ` · ${e.significance}` : ''}`, options: { color: C.body } }], { x: tx, y: y + 0.03, w: 1.9, h: 0.22, fontFace: FONT, fontSize: 9.5, margin: 0, valign: 'middle' })
      badges(slide, eventIndications(e), tx + 1.95, y + 0.03, W - M - tx - 1.95)
    })
    slide.addNotes(items.map((e) => `${countdown(e.date, today)}: ${eventNote(ctx, e)}`).join('\n\n'))
  })

  // Sources & method.
  {
    const slide = addSlide('Sources & method', 'Where this comes from', context)
    const facts: [string, string][] = [
      ['Asset', `${ctx.asset.name}${ctx.asset.company ? ` (${ctx.asset.company})` : ''}`],
      ['Scope', SCOPE_LABEL[ctx.scope]],
      ['Filters', filtersLabel(ctx.filters)],
      ['Order', ORDER_LABEL[ctx.order]],
      ['Exported', ctx.exportedAt.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })],
      ['Events', `${n}${dateSpan(ctx.events) ? ` · ${dateSpan(ctx.events)}` : ''}`],
    ]
    const rule = { type: 'solid' as const, pt: 0.5, color: C.border }
    const none = { type: 'none' as const }
    slide.addTable(
      facts.map(([k, v]) => [
        { text: k, options: { bold: true, color: C.muted } },
        { text: v, options: { color: C.text } },
      ]),
      { x: M, y: TOP + 0.05, w: 5.6, colW: [1.3, 4.3], fontFace: FONT, fontSize: 10.5, valign: 'middle', margin: [0.06, 0.08, 0.06, 0.08], border: [rule, none, rule, none], rowH: 0.4, autoPage: false },
    )
    const byColl = new Map<string, number>()
    for (const e of ctx.events) for (const s of eventSources(e)) byColl.set(s.collection, (byColl.get(s.collection) ?? 0) + 1)
    const colls = [...byColl].sort((a, b) => b[1] - a[1])
    const records = colls.reduce((s, [, c]) => s + c, 0)
    const sx = 6.7
    const sw = W - M - sx
    slide.addText(
      [
        { text: 'Data sources', options: { bold: true, fontSize: 12, color: C.text, breakLine: true } },
        { text: `${plural(records, 'source record')} behind the ${plural(n, 'event')}, by collection`, options: { fontSize: 9.5, color: C.muted } },
      ],
      { x: sx, y: TOP + 0.05, w: sw, h: 0.5, fontFace: FONT, margin: 0, valign: 'top' },
    )
    const shown = colls.slice(0, 9)
    const max = Math.max(1, ...shown.map(([, c]) => c))
    shown.forEach(([coll, count], i) => {
      const y = TOP + 0.7 + i * 0.36
      const meta = collectionMeta(coll)
      slide.addText(meta.label, { x: sx, y, w: 1.7, h: 0.26, fontFace: FONT, fontSize: 9.5, color: C.body, margin: 0, valign: 'middle', fit: 'shrink' })
      slide.addShape(pptx.ShapeType.rect, { x: sx + 1.8, y: y + 0.05, w: Math.max(0.04, ((sw - 2.5) * count) / max), h: 0.16, fill: { color: hex(meta.color) }, line: NO_LINE, objectName: `source-bar ${coll}` })
      slide.addText(String(count), { x: sx + 1.85 + ((sw - 2.5) * count) / max, y, w: 0.6, h: 0.26, fontFace: FONT, fontSize: 9.5, bold: true, color: C.text, margin: 0, valign: 'middle' })
    })
    if (colls.length > shown.length) slide.addText(`+ ${plural(colls.length - shown.length, 'more collection')}`, { x: sx, y: TOP + 0.7 + shown.length * 0.36, w: sw, h: 0.26, fontFace: FONT, fontSize: 9.5, color: C.muted, margin: 0 })
    slide.addText(
      `Method: every event is built from the cited source records (regulatory filings, trial registries, publications, patents, company and news reports), mapped by rule or extracted and consolidated by AI with every merged record cited. Values in this deck come from those records; each timeline slide’s speaker notes list the sources per event, and each title links to the event in PharmaEdge. ${
        a === null
          ? 'The asset’s analytics could not be loaded at export time, so the pipeline, approvals, trials and landscape slides are left out.'
          : a
            ? 'The pipeline, approvals, trials and landscape slides come from the asset’s Analytics tab, built from the same records.'
            : ''
      }`.trim(),
      { x: M, y: 5.75, w: W - 2 * M, h: 1.08, fontFace: FONT, fontSize: 9.5, color: C.body, margin: 10, valign: 'top', fill: { color: C.band } },
    )
  }

  // Page n / N on every slide but the cover.
  slides.forEach((slide, i) => {
    if (i > 0) slide.addText(`${i + 1} / ${slides.length}`, { x: W - M - 1.5, y: 7.06, w: 1.5, h: 0.27, fontFace: FONT, fontSize: 9, color: C.muted, margin: 0, align: 'right', valign: 'middle', objectName: 'page-number' })
  })

  // pptxgenjs 4.0.1's `write` drops `compression` whenever an `outputType` is given (and without one mistakes the
  // options for the type), so every deck came out stored, ~8× larger. Its exporter compresses the default Blob output.
  const exporter = pptx as unknown as { exportPresentation: (p: { compression: boolean }) => Promise<Blob> }
  const blob = await exporter.exportPresentation({ compression: true })
  return new Blob([blob], { type: PPTX_TYPE })
}
