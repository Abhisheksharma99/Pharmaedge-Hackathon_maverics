import { Search, X } from 'lucide-react'
import { useId } from 'react'
import { FiltersToggle } from '@/components/filters-toggle'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCollapsed } from '@/lib/use-collapsed'
import { cn } from '@/lib/utils'
import type { CardFilterSelect } from './use-card-filter'

export type { CardFilterSelect, FilterFacet } from './use-card-filter'

const ALL = '__all__'

/**
 * The filter bar every data card carries (search + indication + any extra dropdowns), shown under the card header.
 * Dropdowns with fewer than two options are left out; `shown`/`total` render "n of m" while a filter is on.
 * The bar can be hidden to a "Filters" chip (remembered per `collapseKey`); its filters keep applying.
 */
export function CardFilters({
  collapseKey,
  defaultCollapsed = false,
  query,
  onQuery,
  placeholder = 'Search',
  selects = [],
  shown,
  total,
  className,
}: {
  /** Stable id of this bar for the remembered hide/show choice, e.g. `home.what-changed`. */
  collapseKey: string
  defaultCollapsed?: boolean
  query: string
  onQuery: (q: string) => void
  placeholder?: string
  selects?: CardFilterSelect[]
  shown?: number
  total?: number
  className?: string
}) {
  const visible = selects.filter((s) => s.options.length > 1 || s.value)
  const nActive = (query.trim() !== '' ? 1 : 0) + visible.filter((s) => s.value).length
  const [collapsed, setCollapsed] = useCollapsed(collapseKey, defaultCollapsed)
  const id = useId()
  const clear = () => {
    onQuery('')
    for (const s of visible) s.onChange(null)
  }
  return (
    <div role="search" className={cn('flex flex-wrap items-center gap-[8px] px-[20px] pt-[12px] pb-[4px] max-[900px]:px-[14px]', className)}>
      <div id={id} hidden={collapsed} className="contents">
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
        {nActive > 0 && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-[32px] items-center gap-[4px] rounded-[8px] px-[8px] text-[12.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-[13px]" />
            Clear
          </button>
        )}
      </div>
      <span className="ml-auto flex items-center gap-[8px]">
        {nActive > 0 && shown !== undefined && total !== undefined && (
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {shown} of {total}
          </span>
        )}
        <FiltersToggle collapsed={collapsed} onCollapsed={setCollapsed} controls={id} active={nActive} onClear={clear} />
      </span>
    </div>
  )
}
