import { useState } from 'react'

/** One dropdown of a card's filter bar. `value` null = all. */
export interface CardFilterSelect {
  label: string
  value: string | null
  options: string[]
  onChange: (value: string | null) => void
}

/** A dropdown filter definition for `useCardFilter`: the values an item has for it (an item matches when any equals the pick). */
export interface FilterFacet<T> {
  label: string
  of: (item: T) => string[]
}

/**
 * Client-side filtering for a card's list: free text over `text(item)` plus one dropdown per facet.
 * Returns the filtered items and the props for `<CardFilters>`.
 */
export function useCardFilter<T>(items: T[], text: (item: T) => string, facets: FilterFacet<T>[] = []) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Record<string, string | null>>({})
  const q = query.trim().toLowerCase()
  const filtered = items.filter(
    (item) => (!q || text(item).toLowerCase().includes(q)) && facets.every((f) => !picked[f.label] || f.of(item).includes(picked[f.label]!)),
  )
  const selects: CardFilterSelect[] = facets.map((f) => ({
    label: f.label,
    value: picked[f.label] ?? null,
    options: [...new Set(items.flatMap(f.of).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    onChange: (v) => setPicked((p) => ({ ...p, [f.label]: v })),
  }))
  return { filtered, filters: { query, onQuery: setQuery, selects, shown: filtered.length, total: items.length } }
}
