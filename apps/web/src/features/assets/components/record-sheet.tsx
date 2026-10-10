import { ExternalLink, FileText, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { formatDay } from '@/lib/dates'
import { formatPhase, formatStatus } from '@/lib/format'
import { safeUrl } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import { CategoryIcon, IndicationBadges, SignificanceBadge } from './badges'
import { useRecord, type RecordEventRef, type RecordTab, type SourceRecord } from '../api'
import { DocumentText, MentionExcerpts } from './document-text'
import { recordIndications } from './record-indications'
import { SlideBody, isSlide, slideHeading } from './slide-record'

const TAB_TITLE: Record<RecordTab, string> = {
  clinical: 'Clinical trials',
  regulatory: 'Regulatory',
  publications: 'Publications',
  conferences: 'Conference abstracts',
  documents: 'Documents',
  'company-ir': 'Company IR',
  patents: 'Patents',
  news: 'News',
}

type Formatter = (value: unknown) => string

const list: Formatter = (v) => (Array.isArray(v) ? v.join(', ') : String(v))

/** Fields worth showing, in order, with labels — whichever a record has. */
const FIELDS: [key: string, label: string, format?: Formatter][] = [
  ['nct_id', 'NCT ID'],
  ['acronym', 'Acronym'],
  ['overall_status', 'Status', (v) => formatStatus(String(v))],
  ['phases', 'Phase', (v) => (Array.isArray(v) ? v.map((p) => formatPhase(String(p))).join(' / ') : String(v))],
  ['lead_sponsor', 'Sponsor'],
  ['start_date', 'Start', (v) => formatDay(String(v))],
  ['primary_completion_date', 'Primary completion', (v) => formatDay(String(v))],
  ['enrollment', 'Enrollment'],
  ['conditions', 'Conditions', list],
  ['interventions', 'Interventions', list],
  ['why_stopped', 'Why stopped'],
  ['application_number', 'Application'],
  ['sponsor_name', 'Sponsor'],
  ['brand_names', 'Brands', list],
  ['submission_status', 'Submission status'],
  ['submission_class', 'Submission class'],
  ['review_priority', 'Review priority'],
  ['medicine_status', 'Status'],
  ['active_substance', 'Active substance'],
  ['marketing_authorisation_developer_applicant_holder', 'Holder'],
  ['therapeutic_area_mesh', 'Therapeutic area'],
  ['publication_number', 'Publication'],
  ['legal_status', 'Legal status'],
  ['assignees', 'Assignees', list],
  ['filing_date', 'Filed', (v) => formatDay(String(v))],
  ['priority_date', 'Priority', (v) => formatDay(String(v))],
  ['grant_date', 'Granted', (v) => formatDay(String(v))],
  ['expiry_date', 'Expires', (v) => formatDay(String(v))],
  ['family_id', 'Family'],
  ['conference', 'Conference'],
  ['meeting', 'Meeting'],
  ['session_title', 'Session'],
  ['session_type', 'Session type'],
  ['category', 'Category'],
  ['journal', 'Journal'],
  ['authors', 'Authors', list],
  ['doi', 'DOI'],
  ['company', 'Publisher'],
  ['keyword', 'Found by keyword'],
  ['mentions', 'Mentions', list],
]

export function recordTitle(r: SourceRecord): string {
  const brands = Array.isArray(r.brand_names) ? (r.brand_names as string[]).join(' / ') : ''
  return (
    (r.title as string) ||
    (r.name_of_medicine as string) ||
    (brands && `${brands} · ${r.submission_type ?? ''}${r.submission_number ?? ''}`) ||
    (r.application_number as string) ||
    r.key
  )
}

/** "Bristol-Myers Squibb", not the crawler's id "bristol_myers_squibb". */
function publisher(r: SourceRecord): string {
  const name = typeof r.company === 'string' && r.company ? r.company : String(r.source ?? r.record_type ?? '')
  return name.includes('_') ? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : name
}

function sourceUrl(r: SourceRecord): string | undefined {
  return safeUrl(r.url) ?? safeUrl(r.medicine_url) ?? safeUrl(r.dhpc_url)
}

/** The journey events built from this record; each opens the event sheet. */
function InTheJourney({ assetId, events, onClose }: { assetId: string; events: RecordEventRef[]; onClose: () => void }) {
  const openEvent = useEventSheet((s) => s.openEvent)
  return (
    <div>
      <p className="mt-[18px] mb-[8px] text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">In the journey</p>
      <ul className="space-y-[8px]">
        {events.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => {
                onClose()
                openEvent(assetId, e.id)
              }}
              className="flex w-full items-center gap-[12px] rounded-[12px] border bg-card p-[12px] text-left hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <CategoryIcon category={e.category} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{e.title}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{formatDay(e.date)}</span>
              </span>
              {e.significance && <SignificanceBadge value={e.significance} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RecordBody({ assetId, record, onClose }: { assetId: string; record: SourceRecord; onClose: () => void }) {
  const fields = FIELDS.filter(([k]) => {
    const v = record[k]
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
  })
  const docs = (Array.isArray(record.documents) ? (record.documents as { url: string; type: string; date?: string }[]) : []).filter((d) => safeUrl(d.url))
  const text = (record.content as string) || (record.abstract as string) || (record.therapeutic_indication as string) || ''
  const url = sourceUrl(record)
  const names = Array.isArray(record.mentions) ? (record.mentions as string[]) : []
  const indications = recordIndications(record)

  return (
    <div className="space-y-[16px]">
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
          Open original <ExternalLink className="size-3.5" />
        </a>
      )}
      {indications.length > 0 && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className="text-[12px] text-muted-foreground">Indication</span>
          <IndicationBadges items={indications} max={indications.length} />
        </div>
      )}
      {fields.length > 0 && (
        <dl className="mt-[16px] grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-[12px] gap-y-[12px]">
          {fields.map(([k, label, format]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{(format ?? String)(record[k])}</dd>
            </div>
          ))}
        </dl>
      )}
      {text && <MentionExcerpts text={text} names={names} />}
      {docs.length > 0 && (
        <div>
          <p className="mb-1.5 font-medium">FDA documents</p>
          <ul className="space-y-1">
            {docs.map((d) => (
              <li key={d.url}>
                <a href={d.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {d.type}
                </a>{' '}
                <span className="text-muted-foreground">{formatDay(d.date ? `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` : '')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {record.journey_events && record.journey_events.length > 0 && (
        <InTheJourney assetId={assetId} events={record.journey_events} onClose={onClose} />
      )}
      {text && <DocumentText text={text} names={names} open={!names.length || text.length < 2500} />}
    </div>
  )
}

/** Slide-over with one record in full. `recordKey` null = closed. */
export function RecordSheet({
  assetId,
  tab,
  recordKey,
  onClose,
}: {
  assetId: string
  tab: RecordTab
  recordKey: string | null
  onClose: () => void
}) {
  const record = useRecord(assetId, tab, recordKey)
  const slide = record.data ? isSlide(record.data) : false

  return (
    <Sheet open={recordKey !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        showCloseButton={false}
        className="w-[min(460px,100vw)] gap-0 overflow-y-auto border-l-0 p-0 shadow-[-16px_0_40px_rgba(16,24,40,.16)] data-[side=right]:w-[min(460px,100vw)] data-[side=right]:sm:max-w-none"
      >
        <div className="flex items-center justify-between border-b border-hair px-[18px] py-[14px]">
          <div className="flex items-center gap-[8px] font-semibold">
            <span className="flex size-[28px] items-center justify-center rounded-[8px] bg-muted text-text-secondary">
              <FileText size={14} aria-hidden="true" />
            </span>
            <span>{`${TAB_TITLE[tab]} record`}</span>
          </div>
          <SheetClose className="flex size-[32px] items-center justify-center rounded-[8px] text-text-secondary hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" aria-label="Close">
            <X size={16} aria-hidden="true" />
          </SheetClose>
        </div>
        <div className="px-[18px] pt-[18px] pb-[24px]">
          <SheetTitle className="text-[20px] leading-[1.3] font-semibold tracking-[-0.015em] text-pretty">
            {record.data ? (slide ? slideHeading(record.data).title : recordTitle(record.data)) : 'Loading…'}
          </SheetTitle>
          <SheetDescription className="mt-[6px] text-[12.5px] text-text-secondary">
            {record.data
              ? slide
                ? slideHeading(record.data).subtitle
                : [formatDay(record.data.date), publisher(record.data)].filter(Boolean).join(' · ')
              : ' '}
          </SheetDescription>
        {record.isPending && (
          <div role="status" aria-label="Loading the record" className="mt-[18px] space-y-[12px]">
            <Skeleton className="h-[48px] w-full" />
            <Skeleton className="h-[48px] w-full" />
            <Skeleton className="h-[120px] w-full" />
          </div>
        )}
        {record.isError && (
          <div role="alert" className="mt-[16px] flex flex-wrap items-center gap-[10px] text-destructive">
            This record couldn't be loaded.
            <Button variant="outline" size="sm" onClick={() => void record.refetch()}>
              <RefreshCw /> Try again
            </Button>
          </div>
        )}
        {record.data &&
          (slide ? <SlideBody record={record.data} /> : <RecordBody assetId={assetId} record={record.data} onClose={onClose} />)}
        </div>
      </SheetContent>
    </Sheet>
  )
}
