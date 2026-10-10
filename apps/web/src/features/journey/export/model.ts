import type { JourneyScope } from '../api'
import { CATEGORY_META } from '../constants'
import { eventIndications } from '../indications'
import type { JourneyOrder, ListFilters } from '../journey-model'
import type { JourneyEventV3, SourceRef } from '../types'

/** Everything an export needs: exactly what the journey shows (scope, filters, order) at the moment of export. */
export interface ExportContext {
  asset: { id: string; name: string; company?: string }
  scope: JourneyScope
  order: JourneyOrder
  filters: ListFilters
  /** The events the journey shows, filtered and in the view's order. */
  events: JourneyEventV3[]
  exportedAt: Date
  /** `window.location.origin`, for the event links. */
  origin: string
}

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'pdf' | 'ics'

export const SCOPE_LABEL: Record<JourneyScope, string> = { key: 'Key events', all: 'All events' }
export const ORDER_LABEL: Record<JourneyOrder, string> = { oldest: 'Oldest first', newest: 'Newest first' }

/** "Category: Clinical, Patents · Starred only · Indication: PAH · Title contains “ralinepag”", or "None". */
export function filtersLabel(f: ListFilters): string {
  const parts = [
    f.cats.length > 0 && `Category: ${f.cats.map((c) => CATEGORY_META[c].label).join(', ')}`,
    f.mine === 'starred' && 'Starred only',
    f.mine === 'notes' && 'Team notes only',
    f.ind && `Indication: ${f.ind}`,
    f.q?.trim() && `Title contains “${f.q.trim()}”`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'None'
}

/** Local `YYYY-MM-DD` of the export. */
export function exportDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `<asset-id>-journey-<scope>-<YYYY-MM-DD>.<ext>`, e.g. `treprostinil-journey-key-events-2026-10-10.csv`. */
export function exportFileName(ctx: Pick<ExportContext, 'asset' | 'scope' | 'exportedAt'>, ext: ExportFormat): string {
  const id = ctx.asset.id.replace(/[^\w.-]+/g, '-')
  return `${id}-journey-${ctx.scope === 'key' ? 'key-events' : 'all-events'}-${exportDay(ctx.exportedAt)}.${ext}`
}

/** The event's date part as stored: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. */
export const isoDate = (date: string) => date.slice(0, 10)

/** Shown milestones still ahead on `today` (`YYYY-MM-DD`; a month- or year-precision date counts until its period ends). */
export function upcomingMilestones(events: JourneyEventV3[], today: string): JourneyEventV3[] {
  return events.filter((e) => {
    const d = isoDate(e.date)
    return e.is_milestone && /^\d{4}(-\d{2}){0,2}$/.test(d) && d >= today.slice(0, d.length)
  })
}

/** Absolute link that opens the event on the Asset Journey page. */
export function eventLink(ctx: Pick<ExportContext, 'asset' | 'origin'>, e: Pick<JourneyEventV3, 'id'>): string {
  return `${ctx.origin}/journey/${encodeURIComponent(ctx.asset.id)}?focus=${encodeURIComponent(e.id)}`
}

/** The event's evidence, its own sources then the ones AI consolidation folded in, without duplicates. */
export function eventSources(e: Pick<JourneyEventV3, 'sources' | 'merged_sources'>): SourceRef[] {
  const seen = new Set<string>()
  return [...(e.sources ?? []), ...(e.merged_sources ?? [])].filter((s) => {
    const k = `${s.collection}:${s.record_key}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** A source's URL when the event carries one (news articles are keyed by their URL). */
export const sourceUrl = (s: SourceRef): string | null => (/^https?:\/\//i.test(s.record_key) ? s.record_key : null)

/** "Summary" plus "Why it matters" when the event has both. */
export function summaryText(e: Pick<JourneyEventV3, 'summary' | 'impact'>): string {
  const summary = e.summary?.trim() ?? ''
  const impact = e.impact?.trim() ?? ''
  if (summary && impact && summary !== impact) return `${summary}\nWhy it matters: ${impact}`
  return summary || impact
}

export const COLUMNS = ['Date', 'Expected', 'Title', 'Category', 'Type', 'Significance', 'Indications', 'Branch', 'Summary / why it matters', 'Sources', 'Event link'] as const

export interface ExportRow {
  date: string
  expected: 'yes' | 'no'
  title: string
  category: string
  type: string
  significance: string
  indications: string
  branch: string
  summary: string
  sources: string
  link: string
}

/** One row per shown event, in the journey's order (CSV, Excel, PDF). */
export function exportRows(ctx: ExportContext): ExportRow[] {
  return ctx.events.map((e) => ({
    date: isoDate(e.date),
    expected: e.is_milestone ? 'yes' : 'no',
    title: e.title,
    category: CATEGORY_META[e.category]?.label ?? e.category,
    type: e.type ?? '',
    significance: e.significance ?? '',
    indications: eventIndications(e).join('; '),
    branch: e.branch ?? '',
    summary: summaryText(e),
    sources: eventSources(e)
      .map((s) => `${s.collection}:${s.record_key}`)
      .join('; '),
    link: eventLink(ctx, e),
  }))
}

/** A row as cells, in `COLUMNS` order. */
export const rowCells = (r: ExportRow): string[] => [r.date, r.expected, r.title, r.category, r.type, r.significance, r.indications, r.branch, r.summary, r.sources, r.link]
