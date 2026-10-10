import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const ALL = '__all__'

/** One dropdown of a card's filter bar. `value` null = all. */
export interface CardFilterSelect {
  label: string
  value: string | null
  options: string[]
  onChange: (value: string | null) => void
}

/**
 * The filter bar every data card carries (search + indication + any extra dropdowns), shown under the card header.
 * Dropdowns with fewer than two options are left out; `shown`/`total` render "n of m" while a filter is on.
 */
export function CardFilters({
  query,
  onQuery,
  placeholder = 'Search',
  selects = [],
  shown,
  total,
  className,
}: {
  query: string
  onQuery: (q: string) => void
  placeholder?: string
  selects?: CardFilterSelect[]
  shown?: number
  total?: number
  className?: string
}) {
  const visible = selects.filter((s) => s.options.length > 1 || s.value)
  const active = query.trim() !== '' || visible.some((s) => s.value)
  return (
    <div role="search" className={cn('flex flex-wrap items-center gap-[8px] px-[20px] pt-[12px] pb-[4px] max-[900px]:px-[14px]', className)}>
      <label className="relative min-w-[160px] flex-1">
        <span className="sr-only">{placeholder}</span>
        <Search className="pointer-events-none absolute top-1/2 left-[9px] size-[14px] -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="h-[32px] w-full rounded-[8px] border border-input bg-card pr-[10px] pl-[28px] text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-primary/12"
        />
      </label>
      {visible.map((s) => (
        <Select key={s.label} value={s.value ?? ALL} onValueChange={(v) => s.onChange(v === ALL ? null : v)}>
          <SelectTrigger size="sm" aria-label={s.label} className="h-[32px] max-w-[200px] min-w-[132px] gap-[6px] rounded-[8px] border-border bg-card px-[8px] py-0 text-[13px] text-secondary-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{s.label}: all</SelectItem>
            {s.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {active && (
        <button
          type="button"
          onClick={() => {
            onQuery('')
            for (const s of visible) s.onChange(null)
          }}
          className="inline-flex h-[32px] items-center gap-[4px] rounded-[8px] px-[8px] text-[12.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-[13px]" />
          Clear
        </button>
      )}
      {active && shown !== undefined && total !== undefined && (
        <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
          {shown} of {total}
        </span>
      )}
    </div>
  )
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
