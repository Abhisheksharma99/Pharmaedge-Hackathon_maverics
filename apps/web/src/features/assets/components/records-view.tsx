import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TabInsights } from '@/features/analytics/tab-insights'
import { stepShort } from '@/features/jobs/steps'
import type { Job } from '@/features/jobs/api'
import { apiFetch } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toQueryString, useRecords, type RecordsPage, type RecordTab, type SourceRecord } from '../api'
import { JourneyLink } from './journey-link'
import { DistributionBar } from './distribution-bar'
import { EmptyState } from './panel'
import { RecordsCard, SearchBox, TD, TH, TR } from './records-cells'
import { RecordsFooter } from './records-footer'
import { Pager } from './pager'
import { RecordSheet } from './record-sheet'

export interface Column {
  header: string
  cell: (r: SourceRecord) => ReactNode
  className?: string
}

const PAGE_SIZE = 25
const ALL = '__all__'

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
  const filterKey = JSON.stringify([picked, toggled])

  // New search or filters → back to page 1.
  useEffect(() => setPage(1), [debouncedQ, filterKey])

  const records = useRecords(assetId, tab, {
    q: debouncedQ || undefined,
    facets: picked,
    ...(toggle && toggled ? { [toggle.param]: true } : {}),
    page,
    pageSize: PAGE_SIZE,
  })
  const data: RecordsPage | undefined = records.data
  const jobStep = useOnboardingStep(assetId, step, onboarding)
  const queued = jobStep?.status === 'pending'

  const label = (key: string, value: string) => facetLabel[key]?.(value) ?? value
  const [lead, ...selects] = data?.facets ?? []
  const leadValues = lead?.values ?? []
  const setFacet = (key: string, value: string | undefined) => setPicked((p) => ({ ...p, [key]: value ?? '' }))
  const filtered = debouncedQ !== '' || Object.values(picked).some(Boolean) || toggled

  const actions = jobStep ? (
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

  return (
    <RecordsCard title={title} description={description} actions={actions}>
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
          <Table className={cn('text-[13px]', records.isFetching && 'opacity-60')}>
            <TableHeader>
              <TableRow className="border-0 bg-background hover:bg-background">
                {columns.map((c) => (
                  <TableHead key={c.header} className={cn(TH, c.className)}>
                    {c.header}
                  </TableHead>
                ))}
                {journeyColumn && <TableHead className={cn(TH, 'pr-[20px]')}>Journey</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r, i) => {
                return (
                  <TableRow
                    key={r.key}
                    tabIndex={0}
                    onClick={() => setOpenKey(r.key)}
                    onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && setOpenKey(r.key)}
                    className={TR}
                    style={{ animationDuration: '350ms', animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  >
                    {columns.map((c) => (
                      <TableCell key={c.header} className={cn(TD, c.className)}>
                        {c.cell(r)}
                      </TableCell>
                    ))}
                    {journeyColumn && (
                      <TableCell className={cn(TD, 'pr-[20px]')}>
                        <JourneyLink assetId={assetId} events={r.journey_events} />
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
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
