import {
  BookOpen,
  ExternalLink,
  FileText,
  FlaskConical,
  Landmark,
  Megaphone,
  Newspaper,
  Presentation,
  Search,
  Stamp,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RecordTab, SourceRecord } from '../api'
import { useEvidenceSummary, useLedger, type Decision, type EvidenceSourceKey, type EvidenceSummary, type LedgerRow } from '../competitors-api'
import { Chip } from '../components/badges'
import { LoadError } from '../components/competitors/load-error'
import { humanize } from '../components/competitors/utils'
import { TAB_FOR_COLLECTION } from '../components/journey-timeline'
import { EmptyState, Panel } from '../components/panel'
import { Pager } from '../components/pager'
import { RecordSheet, recordTitle } from '../components/record-sheet'
import { RecordsView } from '../components/records-view'
import { Segmented } from '../components/segmented'
import { useAssetContext } from './asset-layout'

const SOURCE_ICON: Record<EvidenceSourceKey, LucideIcon> = {
  trials: FlaskConical,
  regulatory: Landmark,
  publications: BookOpen,
  conferences: Presentation,
  pressReleases: Megaphone,
  documents: FileText,
  news: Newspaper,
  patents: Stamp,
}

const DECISIONS: { value: Decision; label: string; badge: string; bar: string }[] = [
  { value: 'ingest', label: 'Ingested', badge: 'bg-success-soft text-success', bar: 'bg-success' },
  { value: 'headline', label: 'Headline', badge: 'bg-warning-soft text-warning', bar: 'bg-[#f79009]' },
  { value: 'skip', label: 'Skipped', badge: 'bg-muted text-muted-foreground', bar: 'bg-input' },
]
const DECISION_META = Object.fromEntries(DECISIONS.map((d) => [d.value, d])) as Record<Decision, (typeof DECISIONS)[number]>

/** Collections the triage model screens, as the ledger names them. */
const LEDGER_SOURCES: [collection: string, label: string][] = [
  ['articles', 'News'],
  ['company_records', 'Press releases'],
  ['publication_records', 'Publications'],
  ['conference_records', 'Conferences'],
]
const SOURCE_LABEL: Record<string, string> = Object.fromEntries(LEDGER_SOURCES)
const ALL = '__all__'
const PAGE_SIZE = 25

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const pct = (n: number, of: number) => (of ? (n / of) * 100 : 0)

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** KpiStrip-style cells on a fixed grid, so the eight sources don't leave one stranded on a second row. */
function SourcesStrip({ sources }: { sources: EvidenceSummary['sources'] }) {
  return (
    <section aria-label="Evidence sources" className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border bg-border sm:grid-cols-4 xl:grid-cols-8">
      {sources.map((s) => {
        const Icon = SOURCE_ICON[s.key] ?? FileText
        return (
          <div key={s.key} className="flex min-w-0 flex-col gap-1.5 bg-card px-[18px] py-4">
            <div className="flex items-center gap-2 font-medium text-text-secondary">
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{s.label}</span>
            </div>
            <div className="text-[28px] leading-8 font-semibold tracking-tight tabular-nums">{formatNumber(s.total)}</div>
            <div className="text-[12.5px] text-muted-foreground">+{formatNumber(s.recent)} in 90 days</div>
          </div>
        )
      })}
    </section>
  )
}

/** Kept vs dropped overall, then per category (bars scaled to the largest category). */
function TriageSummary({ triage }: { triage: EvidenceSummary['triage'] }) {
  const categories = triage.byCategory
    .map((c) => ({ ...c, total: c.ingest + c.headline + c.skip }))
    .sort((a, b) => b.total - a.total)
  const largest = categories[0]?.total ?? 0

  return (
    <div className="grid gap-x-10 gap-y-6 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <p className="text-text-secondary">
          <span className="mr-1.5 text-[22px] font-semibold text-foreground tabular-nums">{formatNumber(triage.total)}</span>
          items screened
        </p>
        <div
          role="img"
          aria-label={DECISIONS.map((d) => `${d.label}: ${triage[d.value]}`).join(', ')}
          className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted"
        >
          {DECISIONS.map((d) => (
            <div key={d.value} className={d.bar} style={{ width: `${pct(triage[d.value], triage.total)}%` }} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {DECISIONS.map((d) => (
            <li key={d.value} className="flex items-center gap-1.5">
              <span className={cn('size-[10px] rounded-[3px]', d.bar)} />
              <span className="font-semibold tabular-nums">{formatNumber(triage[d.value])}</span>
              {d.label}
              <span className="text-muted-foreground tabular-nums">{Math.round(pct(triage[d.value], triage.total))}%</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Ingested items are read in full and feed the journey. Headlines keep only the title and link. Skipped items are dropped, with
          the reason on record.
        </p>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-text-secondary">By category</p>
        <ul className="space-y-2">
          {categories.map((c) => (
            <li
              key={c.category}
              title={DECISIONS.map((d) => `${d.label}: ${c[d.value]}`).join(' · ')}
              className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_48px] items-center gap-3"
            >
              <span className="truncate">{humanize(c.category)}</span>
              <div aria-hidden="true" className="h-2 rounded-full bg-muted">
                <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${pct(c.total, largest)}%` }}>
                  {DECISIONS.map((d) => (
                    <div key={d.value} className={d.bar} style={{ width: `${pct(c[d.value], c.total)}%` }} />
                  ))}
                </div>
              </div>
              <span className="text-right font-medium tabular-nums">{formatNumber(c.total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Paged log of every screening decision. Kept items open as records; the rest link to the original. */
function Ledger({ assetId }: { assetId: string }) {
  const [decision, setDecision] = useState<'all' | Decision>('all')
  const [collection, setCollection] = useState(ALL)
  const [q, setQ] = useState('')
  const debouncedQ = useDebounced(q.trim())
  // A page number belongs to one set of filters; changing them starts at page 1 again.
  const filterKey = `${decision}|${collection}|${debouncedQ}`
  const [paging, setPaging] = useState({ key: filterKey, page: 1 })
  const page = paging.key === filterKey ? paging.page : 1
  const [open, setOpen] = useState<{ tab: RecordTab; key: string } | null>(null)

  const ledger = useLedger(assetId, {
    decision: decision === 'all' ? undefined : decision,
    collection: collection === ALL ? undefined : collection,
    q: debouncedQ || undefined,
    page,
    pageSize: PAGE_SIZE,
  })
  const data = ledger.data

  const activate = (r: LedgerRow) => {
    const tab = TAB_FOR_COLLECTION[r.collection]
    if (tab && r.decision !== 'skip' && r.recordKey) setOpen({ tab, key: r.recordKey })
    else if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer')
  }
  const head = 'h-9 text-xs font-semibold text-text-secondary'

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-t border-[#eef0f3] px-5 py-3">
        <Segmented
          label="Decision"
          value={decision}
          onChange={setDecision}
          options={[{ value: 'all', label: 'All' }, ...DECISIONS.map((d) => ({ value: d.value, label: d.label }))]}
        />
        <Select value={collection} onValueChange={setCollection}>
          <SelectTrigger size="sm" aria-label="Source" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Source: all</SelectItem>
            {LEDGER_SOURCES.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search screened items"
            aria-label="Search screened items"
            className="h-8 w-60 pl-8"
          />
        </div>
      </div>

      {ledger.isPending && (
        <div className="space-y-2 px-5 pb-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {ledger.isError && !data && <p className="px-5 pb-5 text-destructive">The screening log couldn't be loaded.</p>}
      {data && data.total === 0 && <EmptyState title={debouncedQ ? `No results for “${debouncedQ}”` : 'Nothing matches these filters'} />}
      {data && data.items.length > 0 && (
        <>
          <Table className={cn(ledger.isFetching && 'opacity-60')}>
            <TableHeader>
              <TableRow className="bg-background hover:bg-background">
                <TableHead className={cn(head, 'pl-5')}>Date</TableHead>
                <TableHead className={head}>Item</TableHead>
                <TableHead className={head}>Source</TableHead>
                <TableHead className={head}>Decision</TableHead>
                <TableHead className={head}>Category</TableHead>
                <TableHead className={cn(head, 'pr-5')}>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r) => (
                <TableRow
                  key={r.id}
                  tabIndex={0}
                  onClick={() => activate(r)}
                  onKeyDown={(e) => e.key === 'Enter' && activate(r)}
                  className="cursor-pointer"
                >
                  <TableCell className="py-2.5 pl-5 font-mono text-xs text-muted-foreground">{formatDate(r.date)}</TableCell>
                  <TableCell className="max-w-[420px] min-w-[240px] py-2.5 whitespace-normal">
                    {r.url ? (
                      <a
                        href={r.url}
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
                  </TableCell>
                  <TableCell className="py-2.5">
                    <p>{SOURCE_LABEL[r.collection] ?? r.collection}</p>
                    {r.source && <p className="max-w-40 truncate text-xs text-muted-foreground">{r.source}</p>}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-xs font-semibold', DECISION_META[r.decision]?.badge)}>
                      {DECISION_META[r.decision]?.label ?? r.decision}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5">{humanize(r.category)}</TableCell>
                  <TableCell className="min-w-[240px] py-2.5 pr-5 whitespace-normal text-text-secondary">{r.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => setPaging({ key: filterKey, page: p })} />
        </>
      )}
      {open && <RecordSheet assetId={assetId} tab={open.tab} recordKey={open.key} onClose={() => setOpen(null)} />}
    </>
  )
}

export function EvidenceTab() {
  const asset = useAssetContext()
  const summary = useEvidenceSummary(asset.id)
  const data = summary.data

  return (
    <div className="flex flex-col gap-5">
      {data ? (
        <SourcesStrip sources={data.sources} />
      ) : summary.isError ? (
        <LoadError message="The evidence summary couldn't be loaded." onRetry={() => summary.refetch()} />
      ) : (
        <Skeleton className="h-[108px] rounded-[14px]" />
      )}

      {!(summary.isError && !data) && (
        <Panel
          title="AI screening"
          description="What the triage model kept and dropped from news, press releases, publications and conference abstracts, and why"
        >
          {!data && (
            <div className="space-y-2 p-5">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {data?.triage.total === 0 && (
            <EmptyState title="Nothing screened yet">
              News, press releases, publications and conference abstracts are screened during a data refresh.
            </EmptyState>
          )}
          {data && data.triage.total > 0 && (
            <>
              <TriageSummary triage={data.triage} />
              <Ledger assetId={asset.id} />
            </>
          )}
        </Panel>
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
            cell: (r: SourceRecord) => <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</span>,
          },
          { header: 'Headline', cell: (r) => <span className="font-medium">{recordTitle(r)}</span> },
          { header: 'Publisher', cell: (r) => str(r.company) },
          { header: 'Found by', cell: (r) => (str(r.keyword) ? <Chip>{str(r.keyword)}</Chip> : '—') },
        ]}
      />
    </div>
  )
}
