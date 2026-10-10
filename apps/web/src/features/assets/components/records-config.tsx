import { FileText } from 'lucide-react'
import { formatDay } from '@/lib/dates'
import { formatPhase, formatStatus } from '@/lib/format'
import type { AssetDetail, RecordTab, SourceRecord } from '../api'
import { fdaStatus, shortIndication } from './competitors/utils'
import { recordTitle } from './record-sheet'
import { DASH, Mono, StatusBadge, Tag } from './records-cells'
import type { Column } from './records-view'

/**
 * Per-tab columns, facets and copy of the records panel: a port of REC_CFG in the prototype (design_files/pe/records.jsx),
 * with the columns read from the API's record fields. The facets themselves (keys, labels, counts) come from the API.
 */
export interface RecordsTabConfig {
  tab: RecordTab
  title: string
  description: string
  /** The crawl step that fills the tab (drives the onboarding pill and the queued empty state). */
  step: string
  searchPlaceholder: string
  columns: (asset: AssetDetail) => Column[]
  /** Display text of a facet value, per facet key (default: the stored value). */
  facetLabel?: Record<string, (value: string) => string>
  /** Header "N records collected" (prototype: only where the tab has a known total). */
  showTotal?: boolean
  /** Key of the asset's record-store count for this tab. */
  countKey: keyof AssetDetail['counts']
  /** The tab's toggle, sent as a query flag. */
  toggle?: { param: 'companyOnly'; label: string }
}

const RECORD_TYPE_LABEL: Record<string, string> = {
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
  presentation_slide: 'Investor presentation',
  sec_fda_action: 'SEC filing (PDUFA / CRL)',
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])

const monoText = (v: unknown) => (v === undefined || v === null || v === '' ? DASH : <Mono>{String(v)}</Mono>)
const dateText = (v: string | undefined) => (v ? formatDay(v) : '—')
/** The trial window reads "2023-08 → 2027-06" in the prototype: year-month keeps the column narrow. */
const monthText = (v: string | undefined) => (v ? v.slice(0, 7) : '—')
const dateCell = (r: SourceRecord) => <Mono muted>{dateText(r.date)}</Mono>
const titleCell = (r: SourceRecord) => <span className="block max-w-[520px] min-w-[240px] text-pretty">{recordTitle(r)}</span>

/** "Late-breaking" abstracts get the danger tag. */
const isLateBreaking = (v: string) => /late/i.test(v)

/** "CHEST 2025": the congress with its year; the Congress facet counts the same value. */
const congress = (r: SourceRecord) => [str(r.conference), r.year ?? str(r.date).slice(0, 4)].filter(Boolean).join(' ') || '—'

const statusOf = (r: SourceRecord) =>
  fdaStatus(str(r.submission_status)) || str(r.medicine_status) || str(r.status) || str(r.post_authorisation_opinion_status)

export const RECORDS_CONFIG: Record<'clinical' | 'regulatory' | 'publications' | 'conferences' | 'documents' | 'company-ir' | 'patents', RecordsTabConfig> = {
  clinical: {
    tab: 'clinical',
    countKey: 'trials',
    showTotal: true,
    title: 'Clinical trials',
    description: 'ClinicalTrials.gov studies with the asset as an intervention',
    step: 'clinical',
    searchPlaceholder: 'Search clinical trials',
    toggle: { param: 'companyOnly', label: 'Company-sponsored only' },
    facetLabel: { phases: formatPhase, overall_status: formatStatus },
    columns: (asset) => [
      { header: 'NCT ID', cell: (r) => monoText(r.nct_id) },
      {
        header: 'Study',
        cell: (r) => (
          <div className="flex max-w-[440px] min-w-[240px] flex-col">
            <b className="font-semibold">{str(r.acronym) || recordTitle(r)}</b>
            {str(r.acronym) && <span className="text-[12px] text-muted-foreground">{recordTitle(r)}</span>}
          </div>
        ),
      },
      {
        // The Phase facet counts the first phase, as shown here; further phases of a combined trial sit in the tooltip.
        header: 'Phase',
        cell: (r) => {
          const [first, ...rest] = strs(r.phases)
          if (!first) return DASH
          return (
            <span title={strs(r.phases).map(formatPhase).join(' / ')}>
              <Tag>{formatPhase(first)}</Tag>
              {rest.length > 0 && <span className="ml-[4px] text-[11px] text-muted-foreground">+{rest.length}</span>}
            </span>
          )
        },
      },
      { header: 'Status', cell: (r) => <StatusBadge value={r.overall_status ? formatStatus(str(r.overall_status)) : ''} /> },
      {
        header: 'Indication',
        cell: (r) => {
          const [first, ...rest] = strs(r.conditions)
          if (!first) return DASH
          return (
            <span title={strs(r.conditions).join(', ')} className="inline-flex h-[22px] max-w-[170px] items-center rounded-full bg-success-soft px-[8px] text-[12px] font-semibold whitespace-nowrap text-success">
              {/* The prototype shows the short indication tag (PAH, PPF); long condition names truncate, full list in the title. */}
              <span className="truncate">{shortIndication(first)}</span>
              {rest.length > 0 && <span className="ml-[4px] shrink-0 font-normal">+{rest.length}</span>}
            </span>
          )
        },
      },
      {
        header: 'Sponsor',
        cell: (r) => {
          const sponsor = str(r.lead_sponsor)
          const company = sponsor.toLowerCase().includes(asset.company.name.toLowerCase())
          return sponsor ? <span className={company ? '' : 'text-muted-foreground'}>{sponsor}</span> : DASH
        },
      },
      { header: 'Enrolment', cell: (r) => monoText(r.enrollment) },
      {
        header: 'Start → primary completion',
        cell: (r) => (
          <Mono muted>
            {monthText(str(r.start_date))} → {monthText(str(r.primary_completion_date))}
          </Mono>
        ),
      },
    ],
  },
  regulatory: {
    tab: 'regulatory',
    countKey: 'regulatory',
    title: 'Regulatory',
    description: 'FDA and EMA submissions, decisions, recalls and calendar dates',
    step: 'regulatory',
    searchPlaceholder: 'Search regulatory',
    facetLabel: { record_type: (v) => RECORD_TYPE_LABEL[v] ?? v, status: fdaStatus },
    columns: () => [
      { header: 'Date', cell: dateCell },
      { header: 'Region', cell: (r) => <Tag className="font-mono">{str(r.record_type).startsWith('fda') ? 'US' : 'EU'}</Tag> },
      { header: 'Record', cell: (r) => <span>{RECORD_TYPE_LABEL[str(r.record_type)] ?? str(r.record_type)}</span> },
      { header: 'Application', cell: (r) => monoText(r.application_number) },
      { header: 'Product', cell: (r) => <b className="font-medium">{recordTitle(r)}</b> },
      { header: 'Class', cell: (r) => (str(r.submission_class) ? <span className="text-muted-foreground">{str(r.submission_class)}</span> : DASH) },
      { header: 'Status', cell: (r) => <StatusBadge value={statusOf(r)} /> },
    ],
  },
  publications: {
    tab: 'publications',
    countKey: 'publications',
    showTotal: true,
    title: 'Publications',
    description: 'PubMed articles that mention the asset in the title or abstract',
    step: 'publications',
    searchPlaceholder: 'Search publications',
    columns: () => [
      { header: 'PMID', cell: (r) => monoText(r.pmid) },
      { header: 'Title', cell: titleCell },
      { header: 'Journal', cell: (r) => (str(r.journal) ? <i className="text-muted-foreground">{str(r.journal)}</i> : DASH) },
      { header: 'Year', cell: (r) => monoText(r.date?.slice(0, 4)) },
      { header: 'Design', cell: (r) => (strs(r.publication_types)[0] ? <Tag>{strs(r.publication_types)[0]}</Tag> : DASH) },
    ],
  },
  conferences: {
    tab: 'conferences',
    countKey: 'conferences',
    title: 'Conference abstracts',
    description: 'ERS, ATS and CHEST abstracts for the asset',
    step: 'conferences',
    searchPlaceholder: 'Search conference abstracts',
    columns: () => [
      { header: 'Congress', cell: (r) => <b className="font-medium whitespace-nowrap">{congress(r) || '—'}</b> },
      { header: 'Date', cell: dateCell },
      { header: 'Abstract', cell: titleCell },
      {
        header: 'Format',
        cell: (r) => {
          const format = str(r.session_type) || str(r.category)
          return format ? <Tag className={isLateBreaking(format) ? 'bg-danger-soft text-destructive' : undefined}>{format}</Tag> : DASH
        },
      },
    ],
  },
  documents: {
    tab: 'documents',
    countKey: 'documents',
    title: 'Documents',
    description: 'Prescribing information, annual reports and company documents',
    step: 'company_site',
    searchPlaceholder: 'Search documents',
    facetLabel: { record_type: (v) => RECORD_TYPE_LABEL[v] ?? v },
    columns: () => [
      {
        header: 'Document',
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-[10px]">
            <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-muted text-text-secondary">
              <FileText className="size-[14px]" />
            </span>
            <b className="font-medium">{recordTitle(r)}</b>
          </div>
        ),
      },
      { header: 'Type', cell: (r) => <Tag>{RECORD_TYPE_LABEL[str(r.record_type)] ?? str(r.record_type)}</Tag> },
      { header: 'Date', cell: dateCell },
      { header: 'Pages', cell: (r) => monoText(r.pages) },
    ],
  },
  'company-ir': {
    tab: 'company-ir',
    countKey: 'pressReleases',
    showTotal: true,
    title: 'Company IR',
    description: 'Press releases and investor-presentation slides from the company IR site, newest first',
    step: 'company_news',
    searchPlaceholder: 'Search releases and slides',
    facetLabel: { record_type: (v) => RECORD_TYPE_LABEL[v] ?? v },
    columns: (asset) => [
      { header: 'Date', cell: dateCell },
      {
        header: 'Title',
        cell: (r) => (
          <span className="block max-w-[520px] min-w-[240px] text-pretty">
            {r.record_type === 'presentation_slide' && <Tag className="mr-[6px] align-middle">Slide</Tag>}
            {recordTitle(r)}
          </span>
        ),
      },
      {
        // Curated releases carry tags; the rest show the category AI triage gave them for this asset.
        header: 'Category',
        cell: (r) => {
          const triage = (r.triage as Record<string, { category?: string }> | undefined)?.[asset.id]?.category
          const category = strs(r.tags)[0] || (triage ? triage.charAt(0).toUpperCase() + triage.slice(1) : '')
          return category ? <Tag>{category}</Tag> : DASH
        },
      },
    ],
  },
  patents: {
    tab: 'patents',
    countKey: 'patents',
    title: 'Patents',
    description: 'From AdisInsight, PubChem and Google Patents, with computed expiries',
    step: 'patents',
    searchPlaceholder: 'Search patents',
    columns: () => [
      { header: 'Patent', cell: (r) => monoText(r.publication_number) },
      { header: 'Title', cell: titleCell },
      { header: 'Covers', cell: (r) => (str(r.covers) ? <span className="text-muted-foreground">{str(r.covers)}</span> : DASH) },
      { header: 'Assignee', cell: (r) => (strs(r.assignees).length ? strs(r.assignees).join(', ') : DASH) },
      { header: 'Granted', cell: (r) => <Mono muted>{dateText(str(r.grant_date))}</Mono> },
      {
        header: 'Expiry',
        cell: (r) => {
          const expiry = str(r.expiry_date)
          return <Mono muted={!!expiry && expiry < new Date().toISOString().slice(0, 10)}>{dateText(expiry)}</Mono>
        },
      },
      { header: 'Status', cell: (r) => <StatusBadge value={str(r.legal_status)} /> },
    ],
  },
}
