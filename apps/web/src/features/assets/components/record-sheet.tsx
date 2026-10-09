import { ExternalLink, Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatDate, formatPhase, formatStatus } from '@/lib/format'
import { useRecord, type RecordTab, type SourceRecord } from '../api'

type Formatter = (value: unknown) => string

const list: Formatter = (v) => (Array.isArray(v) ? v.join(', ') : String(v))

/** Fields worth showing, in order, with labels — whichever a record has. */
const FIELDS: [key: string, label: string, format?: Formatter][] = [
  ['nct_id', 'NCT ID'],
  ['acronym', 'Acronym'],
  ['overall_status', 'Status', (v) => formatStatus(String(v))],
  ['phases', 'Phase', (v) => (Array.isArray(v) ? v.map((p) => formatPhase(String(p))).join(' / ') : String(v))],
  ['lead_sponsor', 'Sponsor'],
  ['start_date', 'Start', (v) => formatDate(String(v))],
  ['primary_completion_date', 'Primary completion', (v) => formatDate(String(v))],
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
  ['filing_date', 'Filed', (v) => formatDate(String(v))],
  ['priority_date', 'Priority', (v) => formatDate(String(v))],
  ['grant_date', 'Granted', (v) => formatDate(String(v))],
  ['expiry_date', 'Expires', (v) => formatDate(String(v))],
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

function sourceUrl(r: SourceRecord): string | undefined {
  return (r.url as string) || (r.medicine_url as string) || (r.dhpc_url as string) || undefined
}

function RecordBody({ record }: { record: SourceRecord }) {
  const fields = FIELDS.filter(([k]) => {
    const v = record[k]
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
  })
  const docs = Array.isArray(record.documents) ? (record.documents as { url: string; type: string; date?: string }[]) : []
  const text = (record.content as string) || (record.abstract as string) || (record.therapeutic_indication as string) || ''
  const url = sourceUrl(record)

  return (
    <div className="space-y-5 px-4 pb-6">
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
          Open original <ExternalLink className="size-3.5" />
        </a>
      )}
      {fields.length > 0 && (
        <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-2">
          {fields.map(([k, label, format]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{(format ?? String)(record[k])}</dd>
            </div>
          ))}
        </dl>
      )}
      {docs.length > 0 && (
        <div>
          <p className="mb-1.5 font-medium">FDA documents</p>
          <ul className="space-y-1">
            {docs.map((d) => (
              <li key={d.url}>
                <a href={d.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {d.type}
                </a>{' '}
                <span className="text-muted-foreground">{formatDate(d.date ? `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` : '')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {text && (
        <div>
          <p className="mb-1.5 font-medium">Text</p>
          <div className="max-w-none rounded-lg border bg-background p-3 leading-relaxed whitespace-pre-wrap">{text}</div>
        </div>
      )}
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

  return (
    <Sheet open={recordKey !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-6 leading-snug">{record.data ? recordTitle(record.data) : 'Loading…'}</SheetTitle>
          <SheetDescription>
            {record.data ? `${formatDate(record.data.date)} · ${String(record.data.source ?? record.data.record_type ?? '')}` : ' '}
          </SheetDescription>
        </SheetHeader>
        {record.isPending && (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {record.isError && <p className="px-4 text-destructive">This record couldn't be loaded.</p>}
        {record.data && <RecordBody record={record.data} />}
      </SheetContent>
    </Sheet>
  )
}
