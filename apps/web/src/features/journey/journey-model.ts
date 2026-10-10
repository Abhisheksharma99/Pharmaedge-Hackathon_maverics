import { yearFraction } from '@/lib/dates'
import { CATEGORIES, CATEGORY_META, collectionMeta } from './constants'
import { eventIndications } from './indications'
import type { Branch, EventCategory, JourneyEventV3, SourceRef } from './types'

/** The asset's indication branches as lanes. Without branch docs the journey is one unlabeled trunk (DATA_CONTRACTS §B.1). */
export interface BranchModel {
  list: Branch[]
  byId: Map<string, Branch>
  trunk: Branch
  /** Real branches exist: lane labels, fork rows, branch cards and chips are shown. */
  multi: boolean
}

export const SINGLE_TRUNK: Branch = { id: 'journey', label: '', full: '', color: '#2347d9', off: 0, trunk: true, status: '', origin: 'rule' }

export function branchModel(branches: Branch[] | null | undefined): BranchModel {
  const multi = !!branches && branches.length > 0
  const list = multi ? branches : [SINGLE_TRUNK]
  const trunk = list.find((b) => b.trunk) ?? list[0]!
  return { list, byId: new Map(list.map((b) => [b.id, b])), trunk, multi }
}

/** The lane an event is drawn on: its branch when the asset has it, else the trunk. */
export function laneOf(e: Pick<JourneyEventV3, 'branch'>, m: BranchModel): string {
  return e.branch && m.byId.has(e.branch) ? e.branch : m.trunk.id
}

/** Branches a multi-indication event also covers (dotted bridge), without its own lane. */
export function spanOf(e: Pick<JourneyEventV3, 'span' | 'branch'>, m: BranchModel): string[] {
  if (!m.multi || !e.span?.length) return []
  const own = laneOf(e, m)
  return [...new Set(e.span)].filter((id) => id !== own && m.byId.has(id))
}

export const isDated = (e: Pick<JourneyEventV3, 'date'>) => Number.isFinite(yearFraction(e.date))

/** Oldest first; ties by id (the API's neighbour order). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
export const byDate = (a: Pick<JourneyEventV3, 'date' | 'id'>, b: Pick<JourneyEventV3, 'date' | 'id'>) => cmp(a.date, b.date) || cmp(a.id, b.id)

/** Dated events, oldest first. Undated events can't be placed on a time axis. */
export function chronological(events: JourneyEventV3[]): JourneyEventV3[] {
  return events.filter(isDated).sort(byDate)
}

/** h = horizontal track (default, spec §3), v = tree. */
export type JourneyView = 'h' | 'v'

/** Oldest first (default) or newest first; both views read their list in this order. */
export type JourneyOrder = 'oldest' | 'newest'

export type Mine = 'starred' | 'notes'

export interface ListFilters {
  cats: EventCategory[]
  mine: Mine | null
  /** Short indication label (PAH, PH-ILD…); null = every indication. */
  ind?: string | null
  /** Title search. */
  q?: string
}

/** The events a journey view shows: selected categories (none = all), Starred or Team notes, the indication, the title search. */
export function filterJourney(events: JourneyEventV3[], f: ListFilters, stars: string[]): JourneyEventV3[] {
  const starred = new Set(stars)
  const q = f.q?.trim().toLowerCase() ?? ''
  return events.filter(
    (e) =>
      (!f.cats.length || f.cats.includes(e.category)) &&
      (f.mine !== 'starred' || starred.has(e.id)) &&
      (f.mine !== 'notes' || e.via === 'user') &&
      (!f.ind || eventIndications(e).includes(f.ind)) &&
      (!q || e.title.toLowerCase().includes(q)),
  )
}

/** Chip counts over the scope's events (before category / Starred / Team notes filters). */
export function journeyCounts(events: JourneyEventV3[], stars: string[]) {
  const starred = new Set(stars)
  const cats = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<EventCategory, number>
  let nStarred = 0
  let notes = 0
  for (const e of events) {
    if (e.category in cats) cats[e.category]++
    if (starred.has(e.id)) nStarred++
    if (e.via === 'user') notes++
  }
  return { cats, starred: nStarred, notes }
}

/** Where an ended branch closed. */
export interface Closure {
  id: string
  date: string
  title: string
}

const STOP_TYPES = new Set(['trial_stopped', 'trial_terminated', 'trial_withdrawn', 'application_withdrawn', 'withdrawal'])

/**
 * Closure of each ended branch: its latest stopped / withdrawn event, else its latest event. Pass every event of the
 * ended branches (scope=all): the key scope can miss the termination (Treprostinil PH-COPD closes in 2022 although
 * its last key event is a 2025 publication).
 */
export function branchClosures(events: JourneyEventV3[], ended: Iterable<string>): Record<string, Closure> {
  const out: Record<string, Closure> = {}
  for (const id of ended) {
    const mine = chronological(events.filter((e) => e.branch === id))
    const stops = mine.filter((e) => STOP_TYPES.has(e.type))
    const at = stops[stops.length - 1] ?? mine[mine.length - 1]
    if (at) out[id] = { id: at.id, date: at.date, title: at.title }
  }
  return out
}

/** Root-first ancestry of a branch ("PAH › PH-ILD › IPF"); stops at unknown parents and cycles. */
export function lineage(id: string, m: BranchModel): Branch[] {
  const out: Branch[] = []
  const seen = new Set<string>()
  let b = m.byId.get(id)
  while (b && !seen.has(b.id)) {
    out.unshift(b)
    seen.add(b.id)
    b = b.from ? m.byId.get(b.from) : undefined
  }
  return out
}

/** "78 days", "1 day"; over 400 days in years ("4.6 years"). */
export const gapLabel = (days: number) => (days > 400 ? `${(days / 365).toFixed(1)} years` : `${days} day${days === 1 ? '' : 's'}`)

/** Every record behind an event: its sources plus those folded in by AI consolidation, once each. */
export function sourceRefs(e: Pick<JourneyEventV3, 'sources' | 'merged_sources'>): SourceRef[] {
  const seen = new Map<string, SourceRef>()
  for (const r of [...(e.sources ?? []), ...(e.merged_sources ?? [])]) seen.set(`${r.collection}|${r.record_key}`, r)
  return [...seen.values()]
}

/** Card footer: how the event entered the journey. */
export function viaLabel(e: JourneyEventV3): string {
  const refs = sourceRefs(e)
  const first = refs[0]?.collection
  if (e.via === 'user') return e.user?.mode === 'ai' ? `You + AI · ${refs.length} sources` : `Added by ${e.user?.by.name ?? 'a team member'}`
  if (e.via === 'ai_events') return refs.length > 1 ? `AI · merged ${refs.length} records` : 'AI · 1 record'
  if (e.via === 'finalize') return first ? `Rebuild · ${first}` : 'Rebuild'
  return first ? `Rule · ${first}` : 'Rule'
}

/** Detail sheet, under the evidence: how this event was built. */
export function howBuilt(e: JourneyEventV3, nRecords: number): string {
  if (e.via === 'ai_events') return `Extracted and consolidated by AI from ${nRecords} record${nRecords === 1 ? '' : 's'}.`
  if (e.via === 'finalize') return 'Added when the journey was rebuilt with patents and the FDA calendar.'
  if (e.via === 'user') return e.user?.mode === 'ai' ? 'Found by Asset AI from your note.' : 'Added by a team member.'
  return `Mapped by rule (${e.type}).`
}

/** One node of a card's subtree (README §6.2 "Subtree"). */
export interface SubtreeNode {
  label: string
  sub?: string
  mono?: boolean
  /** Leaf dot colour (collection or category). */
  color?: string
  /** Linked journey event: the row jumps to it. */
  eventId?: string
  children?: SubtreeNode[]
}

/** Evidence → key facts, indications, linked events; `resolve` finds linked events (unknown ids are left out). */
export function subtree(e: JourneyEventV3, resolve: (id: string) => JourneyEventV3 | undefined): SubtreeNode[] {
  const out: SubtreeNode[] = []
  const refs = sourceRefs(e)
  const dot = (coll: string) => collectionMeta(coll).color
  if (!refs.length) {
    out.push({ label: 'Added manually', children: [{ label: e.user?.by.name ?? 'Team member', sub: e.user?.created_at.slice(0, 10) }] })
  } else if (refs.length > 1) {
    out.push({
      label: `Consolidated from ${refs.length} records`,
      children: refs.map((r) => ({ label: r.record_key, sub: r.collection, mono: true, color: dot(r.collection) })),
    })
  } else {
    const r = refs[0]!
    const facts = Object.entries(e.details ?? {}).slice(0, 4)
    out.push({
      label: r.record_key,
      sub: r.collection,
      mono: true,
      color: dot(r.collection),
      ...(facts.length && { children: facts.map(([k, v]) => ({ label: v, sub: k })) }),
    })
  }
  if (e.indications?.length) out.push({ label: 'Indications', children: e.indications.map((i) => ({ label: i })) })
  const linked = (e.links ?? []).map(resolve).filter((x): x is JourneyEventV3 => !!x)
  if (linked.length) {
    out.push({
      label: 'Linked journey events',
      children: linked.map((l) => ({
        label: l.title,
        sub: l.is_milestone ? `expected ${l.date.slice(0, 7)}` : l.date,
        eventId: l.id,
        color: CATEGORY_META[l.category]?.color,
      })),
    })
  }
  return out
}

/** Nodes in a subtree (the count on the "Subtree" button). */
export const subtreeSize = (nodes: SubtreeNode[]) => nodes.reduce((n, x) => n + 1 + (x.children?.length ?? 0), 0)
