import { FileText } from 'lucide-react'
import { formatDay } from '@/lib/dates'
import { formatPhase, formatStatus } from '@/lib/format'
import type { AssetDetail, RecordTab, SourceRecord } from '../api'
import { IndicationBadges } from './badges'
import { fdaStatus, shortIndication } from './competitors/utils'
import { recordIndications } from './record-indications'
import { recordTitle } from './record-text'
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
/** Export text of a value, and of a stored date (`YYYY-MM-DD`, `YYYY-MM` or `YYYY`). */
const plain = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const isoDay = (v: unknown) => str(v).slice(0, 10)
const dateColumn: Column = { header: 'Date', cell: dateCell, text: (r) => isoDay(r.date), date: true }
/** Which indication(s) a record belongs to (the API's derived ones, else the record's own indication fields). */
const indicationCell = (r: SourceRecord) => (recordIndications(r).length ? <IndicationBadges items={recordIndications(r)} /> : DASH)
const indicationColumn: Column = { header: 'Indication', cell: indicationCell, text: (r) => recordIndications(r).join('; ') }
/** The API's derived Indication facet (tabs other than clinical): branch ids or bracket-shortened names, shown in the web's short form. */
const INDICATION_FACET = { indication: shortIndication }
const titleCell = (r: SourceRecord) => <span className="block max-w-[520px] min-w-[240px] text-pretty">{recordTitle(r)}</span>
const titleColumn = (header: string): Column => ({ header, cell: titleCell, text: recordTitle })
const region = (r: SourceRecord) => (str(r.record_type).startsWith('fda') ? 'US' : 'EU')

/** "Late-breaking" abstracts get the danger tag. */
const isLateBreaking = (v: string) => /late/i.test(v)

/** "CHEST 2025": the congress with its year; the Congress facet counts the same value. */
const congress = (r: SourceRecord) => [str(r.conference), r.year ?? str(r.date).slice(0, 4)].filter(Boolean).join(' ') || '—'

const statusOf = (r: SourceRecord) =>
  fdaStatus(str(r.submission_status)) || str(r.medicine_status) || str(r.status) || str(r.post_authorisation_opinion_status)

const recordType = (r: SourceRecord) => RECORD_TYPE_LABEL[str(r.record_type)] ?? str(r.record_type)

/** Curated releases carry tags; the rest show the category AI triage gave them for this asset. */
function irCategory(r: SourceRecord, assetId: string): string {
  const triage = (r.triage as Record<string, { category?: string }> | undefined)?.[assetId]?.category
  return strs(r.tags)[0] || (triage ? triage.charAt(0).toUpperCase() + triage.slice(1) : '')
}

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
    facetLabel: { phases: formatPhase, overall_status: formatStatus, conditions: shortIndication },
    columns: (asset) => [
      { header: 'NCT ID', cell: (r) => monoText(r.nct_id), text: (r) => str(r.nct_id) },
      {
        header: 'Study',
        text: (r) => (str(r.acronym) ? `${str(r.acronym)}: ${recordTitle(r)}` : recordTitle(r)),
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
        text: (r) => strs(r.phases).map(formatPhase).join(' / '),
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
      { header: 'Status', cell: (r) => <StatusBadge value={r.overall_status ? formatStatus(str(r.overall_status)) : ''} />, text: (r) => (r.overall_status ? formatStatus(str(r.overall_status)) : '') },
      indicationColumn,
      {
        header: 'Sponsor',
        text: (r) => str(r.lead_sponsor),
        cell: (r) => {
          const sponsor = str(r.lead_sponsor)
          const company = sponsor.toLowerCase().includes(asset.company.name.toLowerCase())
          return sponsor ? <span className={company ? '' : 'text-muted-foreground'}>{sponsor}</span> : DASH
        },
      },
      { header: 'Enrolment', cell: (r) => monoText(r.enrollment), text: (r) => plain(r.enrollment) },
      {
        header: 'Start → primary completion',
        text: (r) => `${monthText(str(r.start_date))} → ${monthText(str(r.primary_completion_date))}`,
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
    facetLabel: { record_type: (v) => RECORD_TYPE_LABEL[v] ?? v, status: fdaStatus, ...INDICATION_FACET },
    columns: () => [
      dateColumn,
      { header: 'Region', cell: (r) => <Tag className="font-mono">{region(r)}</Tag>, text: region },
      { header: 'Record', cell: (r) => <span>{recordType(r)}</span>, text: recordType },
      { header: 'Application', cell: (r) => monoText(r.application_number), text: (r) => plain(r.application_number) },
      { header: 'Product', cell: (r) => <b className="font-medium">{recordTitle(r)}</b>, text: recordTitle },
      indicationColumn,
      { header: 'Class', cell: (r) => (str(r.submission_class) ? <span className="text-muted-foreground">{str(r.submission_class)}</span> : DASH), text: (r) => str(r.submission_class) },
      { header: 'Status', cell: (r) => <StatusBadge value={statusOf(r)} />, text: statusOf },
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
    facetLabel: INDICATION_FACET,
    columns: () => [
      { header: 'PMID', cell: (r) => monoText(r.pmid), text: (r) => plain(r.pmid) },
      titleColumn('Title'),
      indicationColumn,
      { header: 'Journal', cell: (r) => (str(r.journal) ? <i className="text-muted-foreground">{str(r.journal)}</i> : DASH), text: (r) => str(r.journal) },
      { header: 'Year', cell: (r) => monoText(r.date?.slice(0, 4)), text: (r) => str(r.date).slice(0, 4), date: true },
      { header: 'Design', cell: (r) => (strs(r.publication_types)[0] ? <Tag>{strs(r.publication_types)[0]}</Tag> : DASH), text: (r) => strs(r.publication_types)[0] ?? '' },
    ],
  },
  conferences: {
    tab: 'conferences',
    countKey: 'conferences',
    title: 'Conference abstracts',
    description: 'ERS, ATS and CHEST abstracts for the asset',
    step: 'conferences',
    searchPlaceholder: 'Search conference abstracts',
    facetLabel: INDICATION_FACET,
    columns: () => [
      { header: 'Congress', cell: (r) => <b className="font-medium whitespace-nowrap">{congress(r) || '—'}</b>, text: (r) => congress(r).replace(/^—$/, '') },
      dateColumn,
      titleColumn('Abstract'),
      indicationColumn,
      {
        header: 'Format',
        text: (r) => str(r.session_type) || str(r.category),
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
    facetLabel: { record_type: (v) => RECORD_TYPE_LABEL[v] ?? v, ...INDICATION_FACET },
    columns: () => [
      {
        header: 'Document',
        text: recordTitle,
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-[10px]">
            <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-muted text-text-secondary">
              <FileText className="size-[14px]" />
            </span>
            <b className="font-medium">{recordTitle(r)}</b>
          </div>
        ),
      },
      indicationColumn,
      { header: 'Type', cell: (r) => <Tag>{recordType(r)}</Tag>, text: recordType },
      dateColumn,
      { header: 'Pages', cell: (r) => monoText(r.pages), text: (r) => plain(r.pages) },
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
    facetLabel: { record_type: (v) => RECORD_TYPE_LABEL[v] ?? v, ...INDICATION_FACET },
    columns: (asset) => [
      dateColumn,
      {
        header: 'Title',
        text: recordTitle,
        cell: (r) => (
          <span className="block max-w-[520px] min-w-[240px] text-pretty">
            {r.record_type === 'presentation_slide' && <Tag className="mr-[6px] align-middle">Slide</Tag>}
            {recordTitle(r)}
          </span>
        ),
      },
      indicationColumn,
      { header: 'Category', cell: (r) => (irCategory(r, asset.id) ? <Tag>{irCategory(r, asset.id)}</Tag> : DASH), text: (r) => irCategory(r, asset.id) },
    ],
  },
  patents: {
    tab: 'patents',
    countKey: 'patents',
    title: 'Patents',
    description: 'From AdisInsight, PubChem and Google Patents, with computed expiries',
    step: 'patents',
    searchPlaceholder: 'Search patents',
    facetLabel: INDICATION_FACET,
    columns: () => [
      { header: 'Patent', cell: (r) => monoText(r.publication_number), text: (r) => plain(r.publication_number) },
      titleColumn('Title'),
      indicationColumn,
      { header: 'Covers', cell: (r) => (str(r.covers) ? <span className="text-muted-foreground">{str(r.covers)}</span> : DASH), text: (r) => str(r.covers) },
      { header: 'Assignee', cell: (r) => (strs(r.assignees).length ? strs(r.assignees).join(', ') : DASH), text: (r) => strs(r.assignees).join(', ') },
      { header: 'Granted', cell: (r) => <Mono muted>{dateText(str(r.grant_date))}</Mono>, text: (r) => isoDay(r.grant_date), date: true },
      {
        header: 'Expiry',
        text: (r) => isoDay(r.expiry_date),
        date: true,
        cell: (r) => {
          const expiry = str(r.expiry_date)
          return <Mono muted={!!expiry && expiry < new Date().toISOString().slice(0, 10)}>{dateText(expiry)}</Mono>
        },
      },
      { header: 'Status', cell: (r) => <StatusBadge value={str(r.legal_status)} />, text: (r) => str(r.legal_status) },
    ],
  },
}
