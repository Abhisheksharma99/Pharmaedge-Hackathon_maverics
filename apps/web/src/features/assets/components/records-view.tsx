import { useQuery } from '@tanstack/react-query'
import { Quote, RefreshCw } from 'lucide-react'
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FiltersToggle } from '@/components/filters-toggle'
import { TableExportMenu, type TableExportResult } from '@/components/table-export-menu'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TabInsights } from '@/features/analytics/tab-insights'
import { stepShort } from '@/features/jobs/steps'
import type { Job } from '@/features/jobs/api'
import { apiFetch } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useCollapsed } from '@/lib/use-collapsed'
import { cn } from '@/lib/utils'
import { toQueryString, useAsset, useRecords, type RecordsPage, type RecordTab, type SourceRecord } from '../api'
import { JourneyLink } from './journey-link'
import { DistributionBar } from './distribution-bar'
import { EmptyState } from './panel'
import { recordTitle } from './record-text'
import { RecordsCard, SearchBox, TD, TH, TR } from './records-cells'
import { recordCitation } from './records-citation'
import { RecordsColumnsMenu } from './records-columns'
import { RecordsFooter } from './records-footer'
import { Pager } from './pager'
import { RecordSheet } from './record-sheet'
import { EXPORT_CAP, exportedCount, fetchAllRecords, recordsTable } from './records-export'
import { useDensity, useHiddenColumns } from './records-prefs'

export interface Column {
  header: string
  cell: (r: SourceRecord) => ReactNode
  /** The cell as plain text for the CSV / Excel export (dates as stored: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`). */
  text: (r: SourceRecord) => string
  /** Exported as an Excel date. */
  date?: boolean
  className?: string
}

const PAGE_SIZE = 25
const ALL = '__all__'
const JOURNEY = 'Journey'
/** The header stays put while the rows scroll inside the card; a shadow, not the border, rules it off (borders collapse away). */
const STICKY_TH = 'shadow-[inset_0_-1px_0_var(--color-border)] border-b-0'
const CHECK = 'size-[15px] cursor-pointer align-middle accent-primary'

/** Copies a record's citation and says so (the clipboard can be refused: then it says that). */
async function copyCitation(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Citation copied', { description: text })
  } catch {
    toast.error('The citation could not be copied', { description: text })
  }
}

/** Debounce typing so every keystroke doesn't hit the API. */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** The asset's newest crawl job — only fetched while the asset is onboarding. */
function useOnboardingStep(assetId: string, step: string | undefined, onboarding: boolean) {
  const jobs = useQuery({
    queryKey: ['jobs', { asset: assetId }],
    queryFn: () => apiFetch<Job[]>(`/jobs${toQueryString({ asset: assetId })}`),
    enabled: onboarding && step !== undefined,
    refetchInterval: 2000,
  })
  return onboarding ? jobs.data?.[0]?.steps.find((s) => s.name === step) : undefined
}

/** Searchable, paged table over one asset tab; rows open the full record, the Journey column opens its event. */
function RecordsPanel({
  assetId,
  tab,
  title,
  description,
  columns,
  searchPlaceholder = 'Search',
  emptyTitle = 'Nothing here yet',
  emptyHint,
  facetLabel = {},
  toggle,
  step,
  onboarding = false,
  journeyColumn = false,
  showTotal = false,
  storeTotal,
}: {
  assetId: string
  tab: RecordTab
  title: string
  description?: string
  columns: Column[]
  searchPlaceholder?: string
  emptyTitle?: string
  emptyHint?: string
  /** Display text of a facet value, per facet key. */
  facetLabel?: Record<string, (value: string) => string>
  toggle?: { param: 'companyOnly'; label: string }
  /** The crawl step that fills this tab (onboarding pill, queued state). */
  step?: string
  onboarding?: boolean
  /** Adds the "Journey" link column. */
  journeyColumn?: boolean
  /** Header "N records collected" (the prototype shows it only on tabs with a known total). */
  showTotal?: boolean
  /** Records in the asset's record store (from the asset's counts), for the footer. */
  storeTotal?: number
}) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [toggled, setToggled] = useState(false)
  const debouncedQ = useDebounced(q.trim())
  // Ticked rows, across pages and filters, kept whole so "Export selected" needs no refetch.
  const [selected, setSelected] = useState<Map<string, SourceRecord>>(() => new Map())
  const [hidden, setHidden] = useHiddenColumns(tab)
  const [density, setDensity] = useDensity()
  const compact = density === 'compact'
  const headers = [...columns.map((c) => c.header), ...(journeyColumn ? [JOURNEY] : [])]
  // A stored choice that would hide every column (the tab's columns changed) shows them all.
  const hide = headers.some((h) => !hidden.includes(h)) ? hidden : []
  const shownColumns = columns.filter((c) => !hide.includes(c.header))
  const showJourney = journeyColumn && !hide.includes(JOURNEY)
  // New search or filters → back to page 1 (reset while rendering, so the old page number is never fetched with them).
  const filterKey = JSON.stringify([debouncedQ, picked, toggled])
  const [pageFilters, setPageFilters] = useState(filterKey)
  if (pageFilters !== filterKey) {
    setPageFilters(filterKey)
    setPage(1)
  }

  const query = { q: debouncedQ || undefined, facets: picked, ...(toggle && toggled ? { [toggle.param]: true } : {}) }
  const records = useRecords(assetId, tab, { ...query, page, pageSize: PAGE_SIZE })
  const data: RecordsPage | undefined = records.data
  const asset = useAsset(assetId)
  const jobStep = useOnboardingStep(assetId, step, onboarding)
  const queued = jobStep?.status === 'pending'

  const label = (key: string, value: string) => facetLabel[key]?.(value) ?? value
  const [lead, ...selects] = data?.facets ?? []
  const leadValues = lead?.values ?? []
  const setFacet = (key: string, value: string | undefined) => setPicked((p) => ({ ...p, [key]: value ?? '' }))
  const filtered = debouncedQ !== '' || Object.values(picked).some(Boolean) || toggled
  // The facet bar and filter row hide behind a "Filters" chip in the header (remembered per tab); they keep applying.
  const [filtersHidden, setFiltersHidden] = useCollapsed(`records.${tab}`)
  const filtersId = useId()
  const nActive = (q.trim() ? 1 : 0) + Object.values(picked).filter(Boolean).length + (toggled ? 1 : 0)
  const clearFilters = () => {
    setQ('')
    setPicked({})
    setToggled(false)
  }

  const status = jobStep ? (
    <span
      className={cn(
        'inline-flex h-[26px] animate-fade items-center gap-[6px] rounded-full px-[10px] text-[12.5px] font-semibold',
        jobStep.status === 'done' ? 'bg-[#ecfdf3] text-[#067647]' : 'bg-warning-soft text-warning',
      )}
    >
      <i className={cn('size-[6px] rounded-full bg-current', jobStep.status === 'done' ? 'bg-[#17b26a]' : 'animate-blink-dot')} />
      {`${stepShort(jobStep)}: ${jobStep.status === 'pending' ? 'queued' : jobStep.status}`}
    </span>
  ) : showTotal && data && data.all > 0 ? (
    <span className="text-muted-foreground">{`${formatNumber(data.all)} records collected`}</span>
  ) : null
  // What the export holds: the applied search, facet picks and toggle (the debounced search, as the table shows).
  const appliedFilters = [
    debouncedQ && `Search “${debouncedQ}”`,
    ...Object.entries(picked)
      .filter(([, v]) => v)
      .map(([k, v]) => `${data?.facets.find((f) => f.key === k)?.label ?? k}: ${label(k, v)}`),
    toggle && toggled && toggle.label,
  ].filter(Boolean) as string[]
  const filtersText = appliedFilters.join(' · ') || 'None'
  const matching = data?.total ?? 0
  const assetAbout: [string, string][] = [
    ['Asset', asset.data ? (asset.data.company?.name ? `${asset.data.name} (${asset.data.company.name})` : asset.data.name) : assetId],
    ['Asset id', assetId],
    ['Tab', title],
  ]
  // Exports hold the columns the table shows (the Columns menu), plus the source link.
  const exportShape = { sheet: title, columns: shownColumns, journey: showJourney, indications: !columns.some((c) => c.header === 'Indication') }
  const exportRecords = async (): Promise<TableExportResult> => {
    const { items, total } = await fetchAllRecords(assetId, tab, query)
    const count = exportedCount(items.length, total)
    return {
      table: recordsTable({ ...exportShape, records: items, total, about: [...assetAbout, ['Filters', filtersText]] }),
      stem: `${assetId}-${tab}`,
      done: `Exported ${count}`,
      note: items.length < total ? `capped at ${formatNumber(EXPORT_CAP)} rows` : undefined,
    }
  }
  const nSelected = selected.size
  const exportSelected = async (): Promise<TableExportResult> => {
    const items = [...selected.values()]
    return {
      table: recordsTable({ ...exportShape, records: items, total: items.length, about: [...assetAbout, ['Rows', `${items.length} selected`]] }),
      stem: `${assetId}-${tab}-selected`,
      done: `Exported ${exportedCount(items.length, items.length)}`,
    }
  }
  const pageItems = data?.items ?? []
  const pageAll = pageItems.length > 0 && pageItems.every((r) => selected.has(r.key))
  const pageSome = pageItems.some((r) => selected.has(r.key))
  const toggleRow = (r: SourceRecord) =>
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(r.key)) next.delete(r.key)
      else next.set(r.key, r)
      return next
    })
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Map(prev)
      for (const r of pageItems) {
        if (pageAll) next.delete(r.key)
        else next.set(r.key, r)
      }
      return next
    })
  const company = asset.data?.company?.name
  const actions = (
    <span className="flex flex-wrap items-center gap-[12px]">
      {status}
      <FiltersToggle collapsed={filtersHidden} onCollapsed={setFiltersHidden} controls={filtersId} active={nActive} onClear={clearFilters} />
      <RecordsColumnsMenu headers={headers} hidden={hide} onHidden={setHidden} density={density} onDensity={setDensity} />
      <TableExportMenu
        title={
          matching > EXPORT_CAP
            ? `Exports the first ${formatNumber(EXPORT_CAP)} of ${formatNumber(matching)} records`
            : `Exports ${appliedFilters.length ? 'the' : 'all'} ${formatNumber(matching)} record${matching === 1 ? '' : 's'}${appliedFilters.length ? ' matching' : ''}`
        }
        detail={`${appliedFilters.length ? `Filters: ${filtersText}` : 'No filters'} · every page, not only this one${matching > EXPORT_CAP ? ` · capped at ${formatNumber(EXPORT_CAP)} rows` : ''}`}
        disabled={!data || records.isPlaceholderData || matching === 0}
        build={exportRecords}
      />
    </span>
  )

  return (
    <RecordsCard title={title} description={description} actions={actions}>
      {nSelected > 0 && (
        <div role="region" aria-label="Selected records" className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-hair bg-primary-soft px-[20px] py-[8px]">
          <span className="font-semibold text-primary tabular-nums">{`${formatNumber(nSelected)} selected`}</span>
          <TableExportMenu
            label="Export selected"
            title={`Exports the ${formatNumber(nSelected)} selected record${nSelected === 1 ? '' : 's'}`}
            detail="The rows you ticked, on any page, with the columns the table shows"
            build={exportSelected}
          />
          <Button variant="ghost" size="sm" className="h-[32px] rounded-[8px] px-[10px] text-[13px] text-text-secondary" onClick={() => setSelected(new Map())}>
            Clear selection
          </Button>
        </div>
      )}
      <div id={filtersId} hidden={filtersHidden}>
        {lead && (
          <DistributionBar
            label={lead.label}
            items={leadValues.map((v) => ({ value: v.value, label: label(lead.key, v.value), count: v.count }))}
            selected={picked[lead.key]}
            onSelect={(v) => setFacet(lead.key, v)}
          />
        )}
        <div className="flex flex-wrap items-center gap-[10px] px-[20px] py-[12px]">
          <SearchBox value={q} onChange={setQ} placeholder={searchPlaceholder} />
          {selects.map((f) => (
            <Select key={f.key} value={picked[f.key] || ALL} onValueChange={(v) => setFacet(f.key, v === ALL ? undefined : v)}>
              <SelectTrigger size="sm" aria-label={f.label} className="h-[32px] min-w-[144px] gap-[6px] rounded-[8px] border-border bg-card px-[8px] py-0 text-[13px] text-secondary-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{f.label}: all</SelectItem>
                {[...f.values]
                  .sort((a, b) => label(f.key, a.value).localeCompare(label(f.key, b.value)))
                  .map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {label(f.key, v.value)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ))}
          {toggle && (
            <div className="flex items-center gap-[8px]">
              <Switch id={`toggle-${tab}`} checked={toggled} onCheckedChange={setToggled} />
              <Label htmlFor={`toggle-${tab}`} className="text-[13px] font-normal text-text-secondary">
                {toggle.label}
              </Label>
            </div>
          )}
        </div>
      </div>
      {records.isPending && (
        <div role="status" aria-label="Loading records" className="space-y-[8px] p-[20px]">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[32px] w-full" />
          ))}
        </div>
      )}
      {records.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-[10px] p-[20px] text-destructive">
          These records couldn't be loaded.
          <Button variant="outline" size="sm" onClick={() => void records.refetch()}>
            <RefreshCw /> Try again
          </Button>
        </div>
      )}
      {data && data.total === 0 && queued && (
        <EmptyState title="Queued">{`This tab fills in when “${jobStep?.label}” runs.`}</EmptyState>
      )}
      {data && data.total === 0 && !queued && (
        <EmptyState title={filtered ? (debouncedQ ? `No results for “${debouncedQ}”` : 'No records match') : emptyTitle}>
          {filtered ? (debouncedQ ? undefined : 'Try clearing the filters.') : emptyHint}
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <>
          {/* Not the shared Table: its wrapper scrolls sideways only, and the sticky header needs the card's own scroller. */}
          <div data-slot="table-container" className="relative max-h-[min(72vh,780px)] w-full overflow-auto overscroll-x-contain">
            <table data-density={density} className={cn('w-full caption-bottom text-[13px]', records.isFetching && 'opacity-60')}>
              <TableHeader className="sticky top-0 z-[2]">
                <TableRow className="border-0 bg-background hover:bg-background">
                  <TableHead className={cn(TH, STICKY_TH, compact && 'py-[6px]', 'w-[44px] pr-0')}>
                    <input
                      type="checkbox"
                      className={CHECK}
                      aria-label="Select all rows on this page"
                      checked={pageAll}
                      ref={(el) => {
                        if (el) el.indeterminate = pageSome && !pageAll
                      }}
                      onChange={togglePage}
                    />
                  </TableHead>
                  {shownColumns.map((c) => (
                    <TableHead key={c.header} className={cn(TH, STICKY_TH, compact && 'py-[6px]', c.className)}>
                      {c.header}
                    </TableHead>
                  ))}
                  {showJourney && <TableHead className={cn(TH, STICKY_TH, compact && 'py-[6px]')}>Journey</TableHead>}
                  <TableHead className={cn(TH, STICKY_TH, compact && 'py-[6px]', 'w-[48px] pr-[20px]')}>
                    <span className="sr-only">Citation</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r, i) => {
                  const ticked = selected.has(r.key)
                  return (
                    <TableRow
                      key={r.key}
                      tabIndex={0}
                      onClick={() => setOpenKey(r.key)}
                      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && setOpenKey(r.key)}
                      data-state={ticked ? 'selected' : undefined}
                      className={cn(TR, ticked && 'bg-primary-soft/50 hover:bg-primary-soft/70')}
                      style={{ animationDuration: '350ms', animationDelay: `${Math.min(i, 12) * 25}ms` }}
                    >
                      <TableCell className={cn(TD, compact && 'py-[5px]', 'w-[44px] pr-0')} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className={CHECK} aria-label={`Select ${recordTitle(r)}`} checked={ticked} onChange={() => toggleRow(r)} />
                      </TableCell>
                      {shownColumns.map((c) => (
                        <TableCell key={c.header} className={cn(TD, compact && 'py-[5px]', c.className)}>
                          {c.cell(r)}
                        </TableCell>
                      ))}
                      {showJourney && (
                        <TableCell className={cn(TD, compact && 'py-[5px]')}>
                          <JourneyLink assetId={assetId} events={r.journey_events} />
                        </TableCell>
                      )}
                      <TableCell className={cn(TD, compact && 'py-[5px]', 'pr-[20px]')}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-[28px] rounded-[8px] text-muted-foreground hover:text-foreground"
                          aria-label={`Copy citation: ${recordTitle(r)}`}
                          title="Copy citation"
                          onClick={(e) => {
                            e.stopPropagation()
                            void copyCitation(recordCitation(r, tab, company))
                          }}
                        >
                          <Quote className="size-[14px]" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}
      {data && <RecordsFooter shown={data.total} available={data.all} storeTotal={onboarding ? undefined : storeTotal} />}
      <RecordSheet assetId={assetId} tab={tab} recordKey={openKey} onClose={() => setOpenKey(null)} />
    </RecordsCard>
  )
}

/** The tab's insights row (README §7.2) above its records table. News is part of the Evidence tab, which mounts its own row. */
export function RecordsView(props: ComponentProps<typeof RecordsPanel>) {
  return (
    <div className="flex flex-col gap-[16px]">
      {props.tab !== 'news' && <TabInsights assetId={props.assetId} tab={props.tab} expected={props.storeTotal !== 0} />}
      <RecordsPanel {...props} />
    </div>
  )
}
