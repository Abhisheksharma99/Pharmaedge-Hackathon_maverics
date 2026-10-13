import { useMemo } from 'react'
import type { FilterFacet } from '@/components/card-filters'
import { useJourneyEvents } from '@/features/journey/api'
import { CATEGORY_META, collectionMeta } from '@/features/journey/constants'
import { eventIndications } from '@/features/journey/indications'
import type { JourneyEventV3 } from '@/features/journey/types'

/** The journey's own events (team notes are not counted by the analytics blocks). */
export function useChartEvents(assetId: string) {
  const q = useJourneyEvents(assetId, 'all')
  const events = useMemo(() => (q.data?.events ?? []).filter((e) => e.via !== 'user'), [q.data])
  return { events, pending: q.isPending }
}

/** A leftover `safety` category is clinical (the two are one). */
const categoryOf = (e: JourneyEventV3) => ((e.category as string) === 'safety' ? 'clinical' : e.category)

export const eventText = (e: JourneyEventV3) => `${e.title} ${e.type}`
const sourceLabels = (e: JourneyEventV3) => [...new Set([...(e.sources ?? []), ...(e.merged_sources ?? [])].map((s) => collectionMeta(s.collection).label))]

export const INDICATION_FACET: FilterFacet<JourneyEventV3> = { label: 'Indication', of: eventIndications }
export const CATEGORY_FACET: FilterFacet<JourneyEventV3> = { label: 'Category', of: (e) => [CATEGORY_META[categoryOf(e)]?.label ?? String(e.category)] }
export const SIGNIFICANCE_FACET: FilterFacet<JourneyEventV3> = { label: 'Significance', of: (e) => [e.significance] }
export const SOURCE_FACET: FilterFacet<JourneyEventV3> = { label: 'Source', of: sourceLabels }

/** Whether any of a card's filters (search or dropdown) is on. */
export const isFiltering = (f: { query: string; selects: { value: string | null }[] }) => f.query.trim() !== '' || f.selects.some((s) => s.value)

const year = (e: JourneyEventV3) => Number(String(e.date ?? '').slice(0, 4))

/** Events per year and category over `cols` (the unfiltered axis, so the bars keep their place). */
export function activityFromEvents(events: JourneyEventV3[], cols: number[]) {
  return {
    cols,
    series: (Object.keys(CATEGORY_META) as (keyof typeof CATEGORY_META)[]).map((k) => ({
      k,
      l: CATEGORY_META[k].label,
      vals: cols.map((y) => events.filter((e) => categoryOf(e) === k && year(e) === y).length),
    })),
  }
}

export function significanceFromEvents(events: JourneyEventV3[]) {
  const n = (s: string) => events.filter((e) => e.significance === s).length
  return { High: n('High'), Medium: n('Medium'), Low: n('Low') }
}

/** Distinct records the events cite, per source collection; `source` (a collection label) keeps just that one. */
export function sourceMixFromEvents(events: JourneyEventV3[], source?: string | null) {
  const seen = new Map<string, Set<string>>()
  for (const e of events)
    for (const s of [...(e.sources ?? []), ...(e.merged_sources ?? [])]) {
      if (source && collectionMeta(s.collection).label !== source) continue
      seen.set(s.collection, (seen.get(s.collection) ?? new Set()).add(s.record_key))
    }
  return [...seen].map(([coll, keys]) => ({ coll, n: keys.size })).sort((a, b) => b.n - a.n)
}
