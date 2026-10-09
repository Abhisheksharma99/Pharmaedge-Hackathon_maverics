import type { RecordTab } from '@/features/assets/api'
import { CATEGORY_META as BASE_CATEGORY_META } from '@/features/assets/components/badges'
import type { EventCategory, NoteTag } from './types'

export const CATEGORIES: EventCategory[] = ['regulatory', 'clinical', 'safety', 'company', 'ip']

const CATEGORY_COLORS: Record<EventCategory, { color: string; soft: string }> = {
  regulatory: { color: '#2347d9', soft: '#eef2fd' },
  clinical: { color: '#0b7a6f', soft: '#e6f4f2' },
  safety: { color: '#b42318', soft: '#fef3f2' },
  company: { color: '#e0620f', soft: '#fdeee4' },
  ip: { color: '#6941c6', soft: '#f4f3ff' },
}

/** Label, icon and tone from the existing badges, plus the v3 hex colours for SVG. */
export const CATEGORY_META = Object.fromEntries(
  CATEGORIES.map((c) => [c, { ...BASE_CATEGORY_META[c], ...CATEGORY_COLORS[c] }]),
) as Record<EventCategory, (typeof BASE_CATEGORY_META)[EventCategory] & { color: string; soft: string }>

export interface CollectionMeta {
  label: string
  color: string
  tab: RecordTab | null
}

export const COLLECTION_META: Record<string, CollectionMeta> = {
  fda_records: { label: 'FDA', color: '#2347d9', tab: 'regulatory' },
  ema_records: { label: 'EMA', color: '#5873e8', tab: 'regulatory' },
  trial_records: { label: 'ClinicalTrials.gov', color: '#0b7a6f', tab: 'clinical' },
  publication_records: { label: 'PubMed', color: '#475467', tab: 'publications' },
  conference_records: { label: 'Conferences', color: '#7a5af8', tab: 'conferences' },
  patent_records: { label: 'Patents', color: '#6941c6', tab: 'patents' },
  company_records: { label: 'Company', color: '#e0620f', tab: 'company-ir' },
  articles: { label: 'News', color: '#98a2b3', tab: 'news' },
  web_records: { label: 'Web', color: '#98a2b3', tab: null },
}

export function collectionMeta(coll: string): CollectionMeta {
  return COLLECTION_META[coll] ?? { label: coll.replace(/_records$/, ''), color: '#98a2b3', tab: null }
}

/** Indication branches, trunk first; assigned by branch order and persisted on the branch doc. */
export const BRANCH_PALETTE = ['#2347d9', '#0b7a6f', '#6941c6', '#e0620f', '#0e7490', '#b54708']

export const NOTE_TAG_LIST: NoteTag[] = ['Important', 'Missed by AI', 'Question', 'Risk', 'Opportunity']
export const NOTE_TAGS: Record<NoteTag, { color: string }> = {
  Important: { color: '#b42318' },
  'Missed by AI': { color: '#6941c6' },
  Question: { color: '#2347d9' },
  Risk: { color: '#b54708' },
  Opportunity: { color: '#0b7a6f' },
}

export const STAR = { fill: '#fdb022', stroke: '#dc8a0e' }

export const PHASE_COLORS: Record<string, string> = {
  'Phase 1': '#98a2b3',
  'Phase 2': '#7a5af8',
  'Phase 3': '#2347d9',
  'Phase 4': '#0b7a6f',
}

export const STAGES = ['Phase 1', 'Phase 2', 'Phase 3', 'Filed', 'Approved'] as const

export const SIGNIFICANCE_COLORS = { High: '#b42318', Medium: '#dc8a0e', Low: '#98a2b3' } as const

/** Trial status → chart colour (recruiting, active, completed, terminated, other). */
export function trialStatusColor(status: string): string {
  if (/recruit/i.test(status) && !/not.recruiting/i.test(status)) return '#2347d9'
  if (/active/i.test(status)) return '#5873e8'
  if (/complet/i.test(status)) return '#0b7a6f'
  if (/terminat/i.test(status)) return '#b42318'
  return '#98a2b3'
}
