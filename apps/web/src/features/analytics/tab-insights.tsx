import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { ChartCard, ChartGrid } from '@/components/charts/chart-card'
import { Donut } from '@/components/charts/donut'
import { Funnel } from '@/components/charts/funnel'
import { Gantt, GanttScroll } from '@/components/charts/gantt'
import { HBars } from '@/components/charts/h-bars'
import { Heat } from '@/components/charts/heat'
import { StackBars } from '@/components/charts/stack-bars'
import { VBars } from '@/components/charts/v-bars'
import { fdaStatus } from '@/features/assets/components/competitors/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { todayIso, yearFraction } from '@/lib/dates'
import { formatPhase } from '@/lib/format'
import { collectionMeta, PHASE_COLORS, trialStatusColor } from '@/features/journey/constants'
import { statusLabel } from './card-filter-defs'
import { useTabInsights, type Counted, type InsightsTab, type TabInsightsData } from './tab-insights-api'

const PAL = ['#2347d9', '#0b7a6f', '#e0620f', '#6941c6', '#98a2b3', '#5873e8', '#b42318', '#b54708']
const GREY = '#98a2b3'

/** The collection each tab's records live in, for the fallback's colours and labels. */
const TAB_COLLECTION: Record<InsightsTab, string> = {
  clinical: 'trial_records',
  regulatory: 'fda_records',
  publications: 'publication_records',
  conferences: 'conference_records',
  'company-ir': 'company_records',
  patents: 'patent_records',
  documents: 'company_records',
  evidence: 'crawl_ledger',
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)
const every = (n: number) => (n > 20 ? 3 : n > 12 ? 2 : 1)
const sum = (rows: { n: number }[]) => rows.reduce((s, r) => s + r.n, 0)
const facet = (d: TabInsightsData, name: string): Counted[] => d.facets[name] ?? []

/** Year columns spanning the data (no empty sample years), with one value row per group. */
function byYearSeries(rows: { year: number; n: number; group?: string }[]) {
  const years = rows.map((r) => r.year)
  const cols = years.length ? range(Math.min(...years), Math.max(...years)) : []
  const vals = (match: (r: { group?: string }) => boolean) => cols.map((y) => sum(rows.filter((r) => r.year === y && match(r))))
  return { cols, vals }
}

/** Groups ordered by how many records they hold. */
function groupsByCount(rows: { group: string; n: number }[]) {
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.group, (totals.get(r.group) ?? 0) + r.n)
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** Donut slices; a long tail (real PubMed types, trial statuses) folds into one grey "Other" so the legend stays small. */
const slices = (rows: Counted[], colour: (value: string, i: number) => string, label: (v: string) => string = (v) => v) => {
  const top = rows.length > 6 ? rows.slice(0, 5) : rows
  const out = top.map((r, i) => ({ l: label(r.value), v: r.n, c: colour(r.value, i) }))
  if (top.length < rows.length) out.push({ l: 'Other', v: sum(rows.slice(5)), c: GREY })
  return out
}
const palette = (_: string, i: number) => PAL[i % PAL.length]!

/** Curated chart sets per tab (README §7.2). Returns null when the tab's own data is missing → fallback. */
function curated(tab: InsightsTab, d: TabInsightsData): ReactNode[] | null {
  switch (tab) {
    case 'clinical': {
      const status = facet(d, 'overall_status')
      const phases = facet(d, 'phases')
      if (!status.length && !phases.length) return null
      const { cols, vals } = byYearSeries(d.byYearGroup)
      return [
        <ChartCard key="a" title="Phase">
          <VBars
            h={110}
            data={['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map((p) => ({
              l: p.replace('Phase ', 'P'),
              v: sum(phases.filter((x) => formatPhase(x.value) === p)),
              c: PHASE_COLORS[p],
            }))}
          />
        </ChartCard>,
        <ChartCard key="b" title="Status">
          <Donut size={120} sub="trials" data={slices(status, (v) => trialStatusColor(statusLabel(v)), statusLabel)} />
        </ChartCard>,
        <ChartCard key="c" title="Trial starts by year" span={2}>
          <StackBars
            h={110}
            cols={cols}
            every={every(cols.length)}
            series={
              // Without any company-sponsored trial (or without a company name) there is nothing to split by.
              d.byYearGroup.some((r) => r.group === 'company')
                ? [
                    { k: 'co', l: 'Company-sponsored', c: '#2347d9', vals: vals((r) => r.group === 'company') },
                    { k: 'inv', l: 'Investigator / academic', c: GREY, vals: vals((r) => r.group !== 'company') },
                  ]
                : [{ k: 'all', l: 'Trials started', c: '#2347d9', vals: vals(() => true) }]
            }
          />
        </ChartCard>,
      ]
    }
    case 'regulatory': {
      if (!d.byYearGroup.length) return null
      const { cols, vals } = byYearSeries(d.byYearGroup)
      const outcome = (v: string, i: number) =>
        /approv|authoris|positive/i.test(v) ? '#0b7a6f' : /review|expected/i.test(v) ? '#2347d9' : /complete response/i.test(v) ? '#b42318' : PAL[(i + 3) % 8]!
      return [
        <ChartCard key="a" title="Regulatory activity by year" span={2}>
          <StackBars
            h={110}
            cols={cols}
            every={every(cols.length)}
            series={[
              { k: 'US', l: 'FDA (US)', c: PAL[0]!, vals: vals((r) => r.group === 'US') },
              { k: 'EU', l: 'EMA / EC (EU)', c: PAL[1]!, vals: vals((r) => r.group === 'EU') },
            ]}
          />
        </ChartCard>,
        <ChartCard key="b" title="Outcome">
          <Donut size={120} sub="records" data={slices(facet(d, 'submission_status').map((r) => ({ ...r, value: fdaStatus(r.value) })), outcome)} />
        </ChartCard>,
        <ChartCard key="c" title="By product">
          <HBars data={facet(d, 'product').slice(0, 6).map((r, i) => ({ l: r.value, v: r.n, c: PAL[i] }))} />
        </ChartCard>,
      ]
    }
    case 'publications': {
      if (!d.byYear.length) return null
      const { cols, vals } = byYearSeries(d.byYear)
      return [
        <ChartCard key="a" title="Publications per year" description={`All ${d.total} PubMed records`} span={2}>
          <StackBars h={110} cols={cols} every={every(cols.length)} series={[{ k: 'p', l: 'Publications', c: '#475467', vals: vals(() => true) }]} />
        </ChartCard>,
        <ChartCard key="b" title="Study design">
          <Donut size={120} sub="records" data={slices(facet(d, 'publication_types'), palette)} />
        </ChartCard>,
        <ChartCard key="c" title="Journals">
          <HBars data={facet(d, 'journal').slice(0, 5).map((r, i) => ({ l: r.value, v: r.n, c: PAL[i] }))} />
        </ChartCard>,
      ]
    }
    case 'conferences': {
      if (!d.byYearGroup.length) return null
      const order = ['ATS', 'ERS', 'CHEST']
      const congresses = groupsByCount(d.byYearGroup)
        .map(([g]) => g)
        .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
      const years = [...new Set(d.byYearGroup.map((r) => r.year))].sort((a, b) => a - b).map(String)
      return [
        <ChartCard key="a" title="Abstracts by congress and year" span={3}>
          <Heat
            cols={years}
            rows={congresses.map((l) => ({ l }))}
            cell={(r, y) => {
              const n = sum(d.byYearGroup.filter((x) => x.group === r.l && String(x.year) === y))
              return { label: n || '', bg: n ? `rgba(122,90,248,${0.15 + n * 0.3})` : '#f9fafb', fg: n > 1 ? '#fff' : '#6941c6', t: `${r.l} ${y}: ${n}` }
            }}
          />
        </ChartCard>,
        <ChartCard key="b" title="Format">
          <Donut
            size={120}
            sub="abstracts"
            data={slices(facet(d, 'session_type'), (v) => (/late.breaking/i.test(v) ? '#b42318' : /oral/i.test(v) ? '#2347d9' : GREY))}
          />
        </ChartCard>,
      ]
    }
    case 'company-ir': {
      if (!d.byYearGroup.length) return null
      const topics = groupsByCount(d.byYearGroup)
      const { cols, vals } = byYearSeries(d.byYearGroup)
      return [
        <ChartCard key="a" title="Press releases by year and topic" span={3}>
          <StackBars
            h={110}
            cols={cols}
            every={every(cols.length)}
            series={topics.map(([t], i) => ({ k: t, l: t, c: PAL[i % 8]!, vals: vals((r) => r.group === t) }))}
          />
        </ChartCard>,
        <ChartCard key="b" title="Topics">
          <Donut size={120} sub="releases" data={topics.map(([l, v], i) => ({ l, v, c: PAL[i % 8]! }))} />
        </ChartCard>,
      ]
    }
    case 'patents': {
      const terms = d.terms ?? []
      if (!terms.length) return null
      const now = todayIso()
      const years = terms.flatMap((p) => [yearFraction(p.granted), yearFraction(p.expiry)]).filter(Number.isFinite)
      const nowYear = Number(now.slice(0, 4))
      const from = Math.floor(Math.min(...years, nowYear)) - 2
      const to = Math.ceil(Math.max(...years, nowYear)) + 2
      const invalid = (s?: string) => /invalid|revoked/i.test(s ?? '')
      const status = (v: string) => (/expired|ceased|abandon|lapse|withdrawn/i.test(v) ? GREY : /pending/i.test(v) ? '#2347d9' : invalid(v) ? '#b42318' : /litig|assert/i.test(v) ? '#dc8a0e' : '#6941c6')
      return [
        <ChartCard key="a" title="Patent terms" description="Grant to expiry · dashed line is today" span={3}>
          <GanttScroll>
            <Gantt
              from={from}
              to={to}
              rows={[...terms]
                .sort((x, z) => x.expiry.localeCompare(z.expiry))
                .map((p) => ({
                  l: p.number,
                  sub: p.assignee,
                  s: yearFraction(p.granted),
                  e: yearFraction(p.expiry),
                  c: invalid(p.status) ? '#b42318' : p.expiry < now ? GREY : '#6941c6',
                  dash: invalid(p.status),
                  tag: invalid(p.status) ? 'invalidated' : p.expiry.slice(0, 4),
                  tip: [p.title, p.status].filter(Boolean).join(' · '),
                }))}
            />
          </GanttScroll>
        </ChartCard>,
        <ChartCard key="b" title="Status">
          <Donut size={120} sub="patents" data={slices(facet(d, 'legal_status'), status)} />
        </ChartCard>,
      ]
    }
    case 'evidence': {
      const t = d.triage
      if (!t) return null
      const verdict: Record<string, [label: string, colour: string]> = { ingest: ['Ingest', '#0b7a6f'], headline: ['Headline', '#dc8a0e'], skip: ['Skip', GREY] }
      return [
        <ChartCard key="a" title="AI triage" description={`${t.screened} unstructured records screened`} span={2}>
          <Funnel
            steps={[
              { l: 'Screened', v: t.screened, c: GREY },
              { l: 'Relevant', v: t.relevant, c: '#5873e8' },
              { l: 'Ingested in full', v: t.ingested, c: '#2347d9' },
              { l: 'Became journey events', v: t.journey, c: '#0b7a6f' },
            ]}
          />
        </ChartCard>,
        <ChartCard key="b" title="Decisions" description="All screened records">
          <Donut size={120} sub="records" data={facet(d, 'decision').map((r) => ({ l: verdict[r.value]?.[0] ?? r.value, v: r.n, c: verdict[r.value]?.[1] ?? GREY }))} />
        </ChartCard>,
        <ChartCard key="c" title="Top sources">
          <HBars data={facet(d, 'source').slice(0, 5).map((r, i) => ({ l: r.value, v: r.n, c: PAL[i] }))} />
        </ChartCard>,
      ]
    }
    case 'documents': {
      const types = facet(d, 'record_type')
      if (!types.length) return null
      const label = (v: string) => statusLabel(v)
      return [
        <ChartCard key="a" title="Document types">
          <Donut size={120} sub="documents" data={slices(types, palette, label)} />
        </ChartCard>,
        ...(d.top?.length
          ? [
              <ChartCard key="b" title="Pages by document" span={3}>
                <HBars unit=" pp" data={d.top.map((r, i) => ({ l: r.title, v: r.pages, c: PAL[i % 8] }))} />
              </ChartCard>,
            ]
          : []),
      ]
    }
    default:
      return null
  }
}

/** Assets without curated data for the tab: records by year, plus the collections they come from. */
function fallback(tab: InsightsTab, d: TabInsightsData): ReactNode[] {
  const meta = collectionMeta(TAB_COLLECTION[tab])
  const { cols, vals } = byYearSeries(d.byYear)
  return [
    <ChartCard key="a" title="Records by year" span={3}>
      <StackBars h={110} cols={cols} every={every(cols.length)} series={[{ k: tab, l: meta.label, c: meta.color, vals: vals(() => true) }]} />
    </ChartCard>,
    <ChartCard key="b" title="Collections">
      <Donut size={120} sub="records" data={[{ l: meta.label, v: d.total, c: meta.color }]} />
    </ChartCard>,
  ]
}

/** The chart row above a records table (README §7.2); renders nothing when the tab holds no records. */
export function TabInsights({ assetId, tab, expected = true }: { assetId: string; tab: InsightsTab; /** False when the tab is known to hold no records: no skeleton, so nothing collapses afterwards. */ expected?: boolean }) {
  const { data, isPending, isError, refetch } = useTabInsights(assetId, tab)
  if (isPending && !expected) return null
  if (isPending) {
    return (
      <ChartGrid>
        <div role="status" aria-label="Loading insights" aria-busy="true" className="contents">
          <Skeleton className="h-[210px] rounded-[14px] min-[701px]:col-span-2" />
          <Skeleton className="h-[210px] rounded-[14px]" />
          <Skeleton className="h-[210px] rounded-[14px]" />
        </div>
      </ChartGrid>
    )
  }
  if (isError && !data) {
    return (
      <p role="alert" className="m-0 flex flex-wrap items-center gap-[8px] rounded-[14px] border bg-card px-[16px] py-[12px] text-text-secondary">
        The insights couldn’t be loaded.
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw /> Try again
        </Button>
      </p>
    )
  }
  if (!data || data.total === 0) return null
  return <ChartGrid>{curated(tab, data) ?? fallback(tab, data)}</ChartGrid>
}
