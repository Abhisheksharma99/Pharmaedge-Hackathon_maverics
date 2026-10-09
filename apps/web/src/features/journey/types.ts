import type { EventCategory, JourneyEvent, Significance } from '@/features/assets/api'
import type { Job } from '@/features/jobs/api'

export type { EventCategory, Significance }

export type NoteTag = 'Important' | 'Missed by AI' | 'Question' | 'Risk' | 'Opportunity'
/** How an event entered the journey: rule / AI consolidation / rebuild / team member. */
export type EventVia = 'journey' | 'ai_events' | 'finalize' | 'user'

export interface SourceRef {
  collection: string
  record_key: string
}

export interface NoteMeta {
  tag: NoteTag
  by: { id: string; name: string }
  created_at: string
  mode: 'manual' | 'ai'
}

/** JourneyEvent v3: existing fields + optional enrichment (DATA_CONTRACTS §A). */
export interface JourneyEventV3 extends JourneyEvent {
  via: EventVia
  /** e.g. ['PH-ILD (WHO Group 3)']; shown as "Targets". */
  indications?: string[]
  product?: string | null
  /** Ordered key facts: Application, Trial, Phase, Enrollment, Primary endpoint, Status, Sponsor, … */
  details?: Record<string, string>
  /** "Why it matters" (one sentence). */
  impact?: string | null
  /** Branch id; the trunk when absent. */
  branch?: string
  /** Extra branch ids the event also covers (dotted bridge). */
  span?: string[]
  /** Related event ids (subtree + detail "Linked events"). */
  links?: string[]
  /** Only when via === 'user'. */
  user?: NoteMeta
  /** In the "Key events" scope (spec §4.1). */
  key?: boolean
  /** Evidence folded in by AI consolidation. */
  merged_sources?: SourceRef[]
}

export interface Branch {
  id: string
  label: string
  full: string
  color: string
  /** Lane offset: 0 = trunk, negative = left of trunk (vertical) / above (horizontal). */
  off: number
  trunk?: boolean
  from?: string
  why?: string
  status: string
  ended?: 'Terminated' | 'Withdrawn' | null
  origin: 'rule' | 'ai' | 'user'
}

export interface EventComment {
  id: string
  by: { id: string; name: string }
  at: string
  text: string
}

export interface Annotations {
  /** Event ids starred by the current user. */
  stars: string[]
  /** By event id (team-visible). */
  comments: Record<string, EventComment[]>
  /** Team notes (via: 'user'). */
  notes: JourneyEventV3[]
}

export interface JobFeedItem {
  id: number
  t: string
  /** Step name or 'plan'. */
  step: string
  kind: 'info' | 'done' | 'warn' | 'ai' | 'event'
  text: string
  verdict?: 'Ingest' | 'Headline' | 'Skip'
  event_id?: string
  merged?: number
}

export interface JobProgress extends Job {
  /** Records per collection so far. */
  records: { coll: string; count: number }[]
  events_created: number
  feed_cursor: number
  /** Asset records per collection and year, for the forming timeline. */
  record_years: { coll: string; year: number; n: number }[]
}

export interface AnalyticsSpec {
  id: string
  title: string
  chart: 'bars' | 'hbar' | 'stack' | 'donut' | 'gantt' | 'heat' | 'list' | 'none'
  data?: unknown
  cols?: (string | number)[]
  series?: { k: string; l: string; c: string; vals: number[] }[]
  unit?: string
  note?: string
  method: 'index' | 'web' | 'none'
  /** Record keys or URLs; never empty unless method === 'none'. */
  sources: string[]
  refreshed_at: string
}

export interface AnalyticsPin {
  key?: string
  custom?: AnalyticsSpec
}
