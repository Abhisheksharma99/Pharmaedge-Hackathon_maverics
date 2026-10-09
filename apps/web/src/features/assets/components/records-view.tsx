import { Search } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useRecords, type RecordsQuery, type RecordTab, type SourceRecord } from '../api'
import { EmptyState, Panel } from './panel'
import { Pager } from './pager'
import { RecordSheet } from './record-sheet'

export interface Column {
  header: string
  cell: (r: SourceRecord) => ReactNode
  className?: string
}

const PAGE_SIZE = 25

/** Debounce typing so every keystroke doesn't hit the API. */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** Searchable, paged table over one asset tab; rows open the full record. */
export function RecordsView({
  assetId,
  tab,
  title,
  description,
  columns,
  filters = {},
  filterControls,
  searchPlaceholder = 'Search',
  emptyTitle = 'Nothing here yet',
  emptyHint,
}: {
  assetId: string
  tab: RecordTab
  title: string
  description?: string
  columns: Column[]
  /** Extra query filters from the tab's own controls. */
  filters?: Omit<RecordsQuery, 'q' | 'page' | 'pageSize'>
  filterControls?: ReactNode
  searchPlaceholder?: string
  emptyTitle?: string
  emptyHint?: string
}) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const debouncedQ = useDebounced(q.trim())
  const filterKey = JSON.stringify(filters)

  // New search or filters → back to page 1.
  useEffect(() => setPage(1), [debouncedQ, filterKey])

  const records = useRecords(assetId, tab, { ...filters, q: debouncedQ || undefined, page, pageSize: PAGE_SIZE })
  const data = records.data

  return (
    <Panel
      title={title}
      description={description}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {filterControls}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 w-56 pl-8"
            />
          </div>
        </div>
      }
    >
      {records.isPending && (
        <div className="space-y-2 p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {records.isError && <p className="p-5 text-destructive">These records couldn't be loaded.</p>}
      {data && data.total === 0 && (
        <EmptyState title={debouncedQ ? `No results for “${debouncedQ}”` : emptyTitle}>{!debouncedQ && emptyHint}</EmptyState>
      )}
      {data && data.items.length > 0 && (
        <>
          <Table className={cn(records.isFetching && 'opacity-60')}>
            <TableHeader>
              <TableRow className="bg-background hover:bg-background">
                {columns.map((c) => (
                  <TableHead key={c.header} className={cn('h-9 text-xs font-semibold text-text-secondary first:pl-5', c.className)}>
                    {c.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r) => (
                <TableRow
                  key={r.key}
                  tabIndex={0}
                  onClick={() => setOpenKey(r.key)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpenKey(r.key)}
                  className="cursor-pointer"
                >
                  {columns.map((c) => (
                    <TableCell key={c.header} className={cn('py-2.5 whitespace-normal first:pl-5', c.className)}>
                      {c.cell(r)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}
      <RecordSheet assetId={assetId} tab={tab} recordKey={openKey} onClose={() => setOpenKey(null)} />
    </Panel>
  )
}
