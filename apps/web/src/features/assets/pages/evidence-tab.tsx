import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TabInsights } from '@/features/analytics/tab-insights'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDay } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { cn, safeUrl } from '@/lib/utils'
import { TAB_FOR_COLLECTION, type RecordTab, type SourceRecord } from '../api'
import { useEvidenceSummary, useLedger, type Decision, type EvidenceSummary, type LedgerRow } from '../competitors-api'
import { Chip } from '../components/badges'
import { DistributionBar } from '../components/distribution-bar'
import { JourneyLink } from '../components/journey-link'
import { LoadError } from '../components/competitors/load-error'
import { EmptyState } from '../components/panel'
import { Pager } from '../components/pager'
import { RecordSheet, recordTitle } from '../components/record-sheet'
import { RecordsCard, SearchBox, TD, TH, TR, Verdict } from '../components/records-cells'
import { RecordsFooter } from '../components/records-footer'
import { RecordsView } from '../components/records-view'
import { useAssetContext } from './asset-layout'

const DECISIONS: { value: Decision; label: string; badge: string }[] = [
  { value: 'ingest', label: 'Ingest', badge: 'bg-success-soft text-success' },
  { value: 'headline', label: 'Headline', badge: 'bg-warning-soft text-warning' },
  { value: 'skip', label: 'Skip', badge: 'bg-muted text-muted-foreground' },
]
const PAGE_SIZE = 25

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/**
 * The Evidence records panel (screenshot 16, pe/records.jsx): decision distribution bar, search, and the log of every
 * AI triage decision. Kept items open as records; skipped ones link to the original.
 */
function EvidencePanel({ assetId, triage }: { assetId: string; triage: EvidenceSummary['triage'] | undefined }) {
  const [decision, setDecision] = useState<Decision | undefined>()
  const [q, setQ] = useState('')
  const debouncedQ = useDebounced(q.trim())
  // A page number belongs to one set of filters; changing them starts at page 1 again.
  const filterKey = `${decision ?? ''}|${debouncedQ}`
  const [paging, setPaging] = useState({ key: filterKey, page: 1 })
  const page = paging.key === filterKey ? paging.page : 1
  const [open, setOpen] = useState<{ tab: RecordTab; key: string } | null>(null)

  const ledger = useLedger(assetId, { decision, q: debouncedQ || undefined, page, pageSize: PAGE_SIZE })
  const data = ledger.data

  const activate = (r: LedgerRow) => {
    const tab = TAB_FOR_COLLECTION[r.collection]
    if (tab && r.decision !== 'skip' && r.recordKey) setOpen({ tab, key: r.recordKey })
    else if (safeUrl(r.url)) window.open(safeUrl(r.url), '_blank', 'noopener,noreferrer')
  }
    const dist = triage
    ? DECISIONS.map((d) => ({ value: d.value, label: d.label, count: triage[d.value] }))
        .filter((d) => d.count > 0)
        .sort((x, z) => z.count - x.count)
    : []

  return (
    <RecordsCard
      title="Evidence"
      description="Unstructured records and what AI triage decided: ingest in full, keep the headline, or skip"
      actions={triage && triage.total > 0 ? <span className="text-muted-foreground">{`${formatNumber(triage.total)} records collected`}</span> : null}
    >
      <DistributionBar label="Decision" items={dist} selected={decision} onSelect={(v) => setDecision(v as Decision | undefined)} />
      <div className="flex flex-wrap items-center gap-[10px] px-[20px] py-[12px]">
        <SearchBox value={q} onChange={setQ} placeholder="Search evidence" />
      </div>

      {ledger.isPending && (
        <div className="space-y-[8px] px-[20px] pb-[20px]">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[32px] w-full" />
          ))}
        </div>
      )}
      {ledger.isError && !data && <p className="px-[20px] pb-[20px] text-destructive">The screening log couldn't be loaded.</p>}
      {data && data.total === 0 && (
        <EmptyState title={debouncedQ ? `No results for “${debouncedQ}”` : decision ? 'No records match' : 'Nothing screened yet'}>
          {!debouncedQ && !decision && 'News, press releases, publications and conference abstracts are screened during a data refresh.'}
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <>
          <Table className={cn('text-[13px]', ledger.isFetching && 'opacity-60')}>
            <TableHeader>
              <TableRow className="border-0 bg-background hover:bg-background">
                <TableHead className={TH}>Date</TableHead>
                <TableHead className={TH}>Record</TableHead>
                <TableHead className={TH}>Decision</TableHead>
                <TableHead className={TH}>Reason</TableHead>
                <TableHead className={cn(TH, 'pr-[20px]')}>Journey</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r, i) => (
                <TableRow
                  key={r.id}
                  tabIndex={0}
                  onClick={() => activate(r)}
                  onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && activate(r)}
                  className={TR}
                  style={{ animationDuration: '350ms', animationDelay: `${Math.min(i, 12) * 25}ms` }}
                >
                  <TableCell className={cn(TD, 'font-mono whitespace-nowrap text-muted-foreground')}>{formatDay(r.date)}</TableCell>
                  <TableCell className={cn(TD, 'max-w-[440px] min-w-[240px]')}>
                    {safeUrl(r.url) ? (
                      <a
                        href={safeUrl(r.url)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {r.title}
                        <ExternalLink aria-hidden="true" className="ml-1 inline size-3.5 align-[-2px] text-muted-foreground" />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="font-medium">{r.title}</span>
                    )}
                    {r.source && <p className="text-[12px] text-muted-foreground">{r.source}</p>}
                  </TableCell>
                  <TableCell className={TD}>
                    <Verdict value={r.decision} />
                  </TableCell>
                  <TableCell className={cn(TD, 'min-w-[240px] text-muted-foreground')}>{r.reason}</TableCell>
                  <TableCell className={cn(TD, 'pr-[20px]')}>
                    <JourneyLink assetId={assetId} events={r.journey_events} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => setPaging({ key: filterKey, page: p })} />
        </>
      )}
      {data && <RecordsFooter shown={data.total} available={triage?.total ?? data.total} />}
      {open && <RecordSheet assetId={assetId} tab={open.tab} recordKey={open.key} onClose={() => setOpen(null)} />}
    </RecordsCard>
  )
}

export function EvidenceTab() {
  const asset = useAssetContext()
  const summary = useEvidenceSummary(asset.id)
  const data = summary.data

  return (
    <div className="flex flex-col gap-[16px]">
      <TabInsights assetId={asset.id} tab="evidence" />
      {summary.isError && !data ? (
        <LoadError message="The evidence summary couldn't be loaded." onRetry={() => summary.refetch()} />
      ) : (
        <EvidencePanel assetId={asset.id} triage={data?.triage} />
      )}

      <RecordsView
        assetId={asset.id}
        tab="news"
        title="News and wire coverage"
        description="Articles collected for this asset, newest first"
        searchPlaceholder="Search headlines, publishers"
        emptyTitle="No articles yet"
        columns={[
          {
            header: 'Date',
            cell: (r: SourceRecord) => <span className="font-mono whitespace-nowrap text-muted-foreground">{formatDay(r.date)}</span>,
          },
          { header: 'Headline', cell: (r) => <span className="font-medium">{recordTitle(r)}</span> },
          { header: 'Publisher', cell: (r) => str(r.company) },
          { header: 'Found by', cell: (r) => (str(r.keyword) ? <Chip>{str(r.keyword)}</Chip> : '—') },
        ]}
      />
    </div>
  )
}
