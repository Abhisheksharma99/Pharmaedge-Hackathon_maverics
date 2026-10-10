import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toQueryString, type EventCategory, type MarketImpact, type Significance } from '@/features/assets/api'
import { apiFetch } from '@/lib/api'

/** A journey story (API: apps/api/src/assets/story.ts, chat/stories.ts). */
export interface StorySpec {
  from?: string
  to?: string
  since?: string
  category?: EventCategory[]
  significance?: Significance[]
  compare?: string
}

export interface StoryChange {
  kind: 'added' | 'changed' | 'removed'
  field?: string
  before?: unknown
  after?: unknown
  at: string
}

export interface StoryEvent {
  id: string
  date: string
  type: string
  category: EventCategory
  title: string
  summary?: string
  significance: Significance
  upcoming: boolean
  origin: 'rule' | 'ai'
  region?: string
  indication?: string
  phase?: string
  sponsor?: string
  /** false: another company's product of the same molecule */
  ownProduct?: boolean
  source: { collection: string; record_key: string } | null
  sources: number
  change?: StoryChange
  verification?: { status: 'confirmed' | 'unconfirmed' | 'conflict'; note: string; against: string[] }
  impact?: MarketImpact | null
}

export interface ApprovalStep {
  id: string
  date: string
  region: string
  product: string
  level: number
}

export interface Chapter {
  id: string
  name: string
  from: string
  to: string
  focus: boolean
  events: number
  byCategory: Partial<Record<EventCategory, number>>
  highlights: string[]
}

export interface StoryChanges {
  since: string | null
  developments: StoryEvent[]
  updates: (StoryChange & { eventId: string; title: string; category: string; eventDate: string })[]
  checks: StoryEvent[]
  slides: { recordKey: string; title: string; date: string; metric: string; value: string }[]
  labels: StoryEvent[]
  trials: StoryEvent[]
  firstSeen: { total: number; kept: number; headline: number; items: { title: string; date: string; source: string; category: string; decision: string; url: string | null }[] }
  upcoming: StoryEvent[]
}

export interface Story {
  asset: { id: string; name: string; company: string | null }
  market: { ticker: string; listedName: string | null; viaParent: boolean; source: string | null; closes: { date: string; close: number }[] } | null
  spec: StorySpec
  range: { from: string; to: string; today: string }
  approvals: ApprovalStep[]
  lanes: { category: EventCategory; events: StoryEvent[]; total: number }[]
  changes: StoryChanges
  chapters: Chapter[]
  compare: { asset: { id: string; name: string }; events: StoryEvent[]; deltas: { label: string; primary: string; other: string; note?: string }[] } | null
  counts: { events: number; shown: number; byCategory: Partial<Record<EventCategory, number>> }
}

export interface StoryNote {
  id: string
  text: string
  eventIds: string[]
}

export interface SavedStory {
  id: string
  assetId: string
  title: string
  question: string | null
  spec: StorySpec
  notes: StoryNote[]
  chapterNames: Record<string, string>
  updatedAt: string
  story: Story
}

export type StorySummary = Pick<SavedStory, 'id' | 'assetId' | 'title' | 'question' | 'updatedAt'>

/** Filters the analyst applies on top of the story's own spec; `compare: 'none'` turns the comparison off. */
export interface StoryFilters {
  from?: string
  to?: string
  category?: EventCategory[]
  significance?: Significance[]
  compare?: string
}

const listKey = (assetId: string) => ['stories', 'list', assetId] as const

export function useStories(assetId: string) {
  return useQuery({ queryKey: listKey(assetId), queryFn: () => apiFetch<StorySummary[]>(`/stories${toQueryString({ asset: assetId })}`) })
}

export function useStory(id: string | null, filters: StoryFilters) {
  return useQuery({
    queryKey: ['stories', 'one', id, filters],
    queryFn: () => apiFetch<SavedStory>(`/stories/${encodeURIComponent(id!)}${toQueryString(filters)}`),
    enabled: id !== null,
    placeholderData: keepPreviousData,
  })
}

export function useDeleteStory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/stories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stories'] }),
  })
}
