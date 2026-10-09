import { CalendarClock, FlaskConical, Landmark, Megaphone, Route } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { LiveBuild } from '@/features/journey/live-build/live-build'
import { formatDate, formatNumber, formatPhase, formatStatus } from '@/lib/format'
import type { SourceRecord } from '../api'
import { AdverseEventsChart } from '../components/adverse-events-chart'
import { Chip } from '../components/badges'
import { JourneyTimeline } from '../components/journey-timeline'
import { UpcomingMilestones } from '../components/milestones'
import { EmptyState, KpiStrip, Panel } from '../components/panel'
import { recordTitle } from '../components/record-sheet'
import { RecordsView } from '../components/records-view'
import { useAssetContext } from './asset-layout'

export const RECORD_TYPE_LABEL: Record<string, string> = {
  fda_submission: 'FDA submission',
  fda_recall: 'FDA recall',
  fda_calendar_event: 'FDA calendar (PDUFA / AdCom)',
  ema_epar: 'EMA medicine (EPAR)',
  ema_post_authorisation: 'EMA post-authorisation',
  ema_orphan_designation: 'EMA orphan designation',
  ema_dhpc: 'EMA safety communication',
  ema_referral: 'EMA referral',
  ema_chmp_opinion: 'CHMP opinion',
  ema_chmp_highlight: 'CHMP meeting highlights',
  prescribing_info: 'Prescribing information',
  annual_report: 'Annual report',
  company_document: 'Company document',
  company_page: 'Company web page',
  press_release: 'Press release',
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const dateCell = (r: SourceRecord) => <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</span>
const ALL = '__all__'

/** Select whose "All" choice maps to "no filter". */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [value: string, label: string][]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={label} className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: all</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
const asFilter = (v: string) => (v === ALL ? undefined : v.split(','))

export function OverviewTab() {
  const asset = useAssetContext()
  const [params, setParams] = useSearchParams()
  // "Explore the journey" leaves the live build even if the asset still reads as onboarding.
  const [exploredId, setExploredId] = useState<string | null>(null)
  // After "Explore the journey" its button is gone: hand focus to the Overview content.
  const focusJourney = useRef(false)
  const journeyRef = useCallback((node: HTMLDivElement | null) => {
    if (node && focusJourney.current) {
      focusJourney.current = false
      node.focus()
    }
  }, [])
  const { kpis, counts } = asset
  const journey = (
    <div ref={journeyRef} tabIndex={-1} className="flex flex-col gap-5 outline-none">
      <KpiStrip
        items={[
          {
            label: 'Approved in',
            icon: Landmark,
            value: kpis.approvalRegions.length ? kpis.approvalRegions.join(', ') : '—',
            hint: 'FDA and EMA authorisations',
          },
          { label: 'Active trials', icon: FlaskConical, value: formatNumber(kpis.activeTrials), hint: `${kpis.activePhase3} in Phase 3` },
          { label: 'Upcoming milestones', icon: CalendarClock, value: formatNumber(kpis.upcomingMilestones), hint: 'Trial readouts and patent expiries' },
          { label: 'Journey events', icon: Route, value: formatNumber(counts.events), hint: 'Regulatory, clinical, patent and company history' },
          { label: 'Company releases', icon: Megaphone, value: formatNumber(counts.pressReleases), hint: asset.company.name },
        ]}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <JourneyTimeline assetId={asset.id} />
        <div className="flex flex-col gap-5">
          <UpcomingMilestones assetId={asset.id} />
          <AdverseEventsChart assetId={asset.id} />
        </div>
      </div>
    </div>
  )
  // A failed or cancelled crawl flips the asset to 'failed': show its build (it says why) when there is a job, else the journey.
  if (params.get('build') === '1' || ((asset.status === 'onboarding' || asset.status === 'failed') && exploredId !== asset.id)) {
    return (
      <LiveBuild
        key={asset.id}
        asset={asset}
        fallback={asset.status === 'failed' && params.get('build') !== '1' ? journey : undefined}
        onExplore={() => {
          focusJourney.current = true
          setExploredId(asset.id)
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev)
              next.delete('build')
              return next
            },
            { replace: true },
          )
        }}
      />
    )
  }
  return journey
}

export function ClinicalTab() {
  const asset = useAssetContext()
  const [phase, setPhase] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  return (
    <RecordsView
      assetId={asset.id}
      tab="clinical"
      title="Clinical trials"
      description={`ClinicalTrials.gov studies with ${asset.name} as an intervention, newest first`}
      searchPlaceholder="Search trials, NCT ID, sponsor"
      filters={{ phase: asFilter(phase), status: asFilter(status) }}
      filterControls={
        <>
          <FilterSelect
            label="Phase"
            value={phase}
            onChange={setPhase}
            options={[['PHASE1', 'Phase 1'], ['PHASE2', 'Phase 2'], ['PHASE3', 'Phase 3'], ['PHASE4', 'Phase 4']]}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              ['RECRUITING,NOT_YET_RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION', 'Active'],
              ['COMPLETED', 'Completed'],
              ['TERMINATED,WITHDRAWN,SUSPENDED', 'Stopped'],
            ]}
          />
        </>
      }
      columns={[
        {
          header: 'Trial',
          cell: (r) => (
            <div>
              <p className="font-medium">{str(r.acronym) || recordTitle(r)}</p>
              <p className="font-mono text-xs text-muted-foreground">{str(r.nct_id)}</p>
            </div>
          ),
        },
        {
          header: 'Phase',
          cell: (r) => (Array.isArray(r.phases) && r.phases.length ? r.phases.map((p) => formatPhase(String(p))).join(' / ') : '—'),
          className: 'whitespace-nowrap',
        },
        { header: 'Status', cell: (r) => formatStatus(str(r.overall_status)), className: 'whitespace-nowrap' },
        { header: 'Sponsor', cell: (r) => str(r.lead_sponsor) },
        { header: 'Start', cell: dateCell },
        { header: 'Primary completion', cell: (r) => <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDate(str(r.primary_completion_date))}</span> },
      ]}
    />
  )
}

export function RegulatoryTab() {
  const asset = useAssetContext()
  const [type, setType] = useState(ALL)
  return (
    <div className="flex flex-col gap-5">
      <RecordsView
        assetId={asset.id}
        tab="regulatory"
        title="Regulatory records"
        description="FDA (Drugs@FDA, enforcement) and EMA records, newest first"
        searchPlaceholder="Search brand, application, medicine"
        filters={{ type: asFilter(type) }}
        filterControls={
          <FilterSelect
            label="Type"
            value={type}
            onChange={setType}
            options={[
              ['fda_submission', 'FDA submissions'],
              ['fda_recall', 'FDA recalls'],
              ['fda_calendar_event', 'FDA calendar (PDUFA, AdCom)'],
              ['ema_epar', 'EMA medicines'],
              ['ema_post_authorisation', 'EMA post-authorisation'],
              ['ema_orphan_designation', 'EMA orphan designations'],
              ['ema_dhpc,ema_referral', 'EMA safety & referrals'],
              ['ema_chmp_opinion,ema_chmp_highlight', 'CHMP opinions'],
            ]}
          />
        }
        columns={[
          { header: 'Date', cell: dateCell },
          { header: 'Agency', cell: (r) => (str(r.record_type).startsWith('fda') ? 'FDA' : 'EMA') },
          { header: 'Record', cell: (r) => <span className="font-medium">{recordTitle(r)}</span> },
          { header: 'Type', cell: (r) => str(r.submission_class) || RECORD_TYPE_LABEL[str(r.record_type)] || str(r.record_type) },
          {
            header: 'Status',
            cell: (r) => str(r.submission_status) || str(r.medicine_status) || str(r.status) || str(r.post_authorisation_opinion_status) || '—',
          },
        ]}
      />
      <AdverseEventsChart assetId={asset.id} />
    </div>
  )
}

export { EvidenceTab } from './evidence-tab'

export function PublicationsTab() {
  const asset = useAssetContext()
  return (
    <RecordsView
      assetId={asset.id}
      tab="publications"
      title="Publications"
      description="Peer-reviewed literature from PubMed"
      emptyTitle="No publications collected yet"
      emptyHint="Refresh data to search PubMed for this asset."
      columns={[
        { header: 'Date', cell: dateCell },
        { header: 'Title', cell: (r) => <span className="font-medium">{recordTitle(r)}</span> },
        { header: 'Journal', cell: (r) => str(r.journal) },
      ]}
    />
  )
}

export function ConferencesTab() {
  const asset = useAssetContext()
  return (
    <RecordsView
      assetId={asset.id}
      tab="conferences"
      title="Conference abstracts"
      description={`ERS, ATS and CHEST abstracts that mention ${asset.name} or its brands`}
      searchPlaceholder="Search titles, sessions, authors"
      emptyTitle="No conference abstracts yet"
      emptyHint="Refresh data to match this asset against the conference corpus."
      columns={[
        { header: 'Date', cell: dateCell },
        { header: 'Abstract', cell: (r) => <span className="font-medium">{recordTitle(r)}</span> },
        {
          header: 'Conference',
          cell: (r) => <Chip>{[str(r.conference), r.year].filter(Boolean).join(' ')}</Chip>,
          className: 'whitespace-nowrap',
        },
        { header: 'Session', cell: (r) => str(r.session_type) || str(r.category) || '—' },
      ]}
    />
  )
}

export function DocumentsTab() {
  const asset = useAssetContext()
  const [type, setType] = useState(ALL)
  return (
    <RecordsView
      assetId={asset.id}
      tab="documents"
      title="Documents"
      description={`Prescribing information, annual reports and product pages from ${asset.company.name}`}
      searchPlaceholder="Search documents"
      filters={{ type: asFilter(type) }}
      filterControls={
        <FilterSelect
          label="Type"
          value={type}
          onChange={setType}
          options={[
            ['prescribing_info', 'Prescribing information'],
            ['annual_report', 'Annual reports'],
            ['company_page', 'Web pages'],
            ['company_document', 'Other documents'],
          ]}
        />
      }
      columns={[
        { header: 'Document', cell: (r) => <span className="font-medium">{recordTitle(r)}</span> },
        { header: 'Type', cell: (r) => RECORD_TYPE_LABEL[str(r.record_type)] ?? str(r.record_type) },
        {
          header: 'Mentions',
          cell: (r) => (Array.isArray(r.mentions) && r.mentions.length ? (r.mentions as string[]).join(', ') : '—'),
        },
      ]}
    />
  )
}

export function CompanyIrTab() {
  const asset = useAssetContext()
  const [mentionsOnly, setMentionsOnly] = useState(true)
  return (
    <RecordsView
      assetId={asset.id}
      tab="company-ir"
      title={`${asset.company.name} press releases`}
      description="From the company's investor-relations site"
      searchPlaceholder="Search releases"
      filters={{ mentionsOnly }}
      filterControls={
        <div className="flex items-center gap-2">
          <Switch id="mentions-only" checked={mentionsOnly} onCheckedChange={setMentionsOnly} />
          <Label htmlFor="mentions-only" className="font-normal text-text-secondary">
            Mentioning {asset.name}
          </Label>
        </div>
      }
      columns={[
        { header: 'Date', cell: dateCell },
        { header: 'Release', cell: (r) => <span className="font-medium">{recordTitle(r)}</span> },
        {
          header: 'Mentions',
          cell: (r) => (
            <div className="flex flex-wrap gap-1">
              {(Array.isArray(r.mentions) ? (r.mentions as string[]) : []).map((m) => (
                <Chip key={m} className="h-5 px-1.5 text-xs">
                  {m}
                </Chip>
              ))}
            </div>
          ),
        },
      ]}
    />
  )
}

export function SoonTab({ title, summary }: { title: string; summary: string }) {
  return (
    <Panel title={title}>
      <EmptyState title="Coming soon">{summary}</EmptyState>
    </Panel>
  )
}

export function PatentsTab() {
  const asset = useAssetContext()
  const [status, setStatus] = useState(ALL)
  return (
    <RecordsView
      assetId={asset.id}
      tab="patents"
      title="Patents"
      description={`Patents of ${asset.company.name} linked to ${asset.name}, from AdisInsight, PubChem and Google Patents`}
      searchPlaceholder="Search titles, numbers, assignees"
      emptyTitle="No patents collected yet"
      emptyHint="Refresh data to run the patent crawler (about 10 minutes)."
      filters={{ status: asFilter(status) }}
      filterControls={
        <FilterSelect
          label="Legal status"
          value={status}
          onChange={setStatus}
          options={[
            ['Active,Granted', 'In force'],
            ['Pending', 'Pending'],
            ['Expired - Lifetime,Expired - Fee Related,Ceased,Abandoned,Withdrawn,Revoked', 'Lapsed'],
          ]}
        />
      }
      columns={[
        {
          header: 'Patent',
          cell: (r) => (
            <div>
              <p className="font-medium">{recordTitle(r)}</p>
              <p className="font-mono text-xs text-muted-foreground">{str(r.publication_number)}</p>
            </div>
          ),
        },
        { header: 'Status', cell: (r) => str(r.legal_status) || '—', className: 'whitespace-nowrap' },
        { header: 'Filed', cell: (r) => <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{str(r.filing_date) ? formatDate(str(r.filing_date)) : '—'}</span> },
        { header: 'Expires', cell: (r) => <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{str(r.expiry_date) ? formatDate(str(r.expiry_date)) : '—'}</span> },
      ]}
    />
  )
}

export { CompetitorsTab } from './competitors-tab'
