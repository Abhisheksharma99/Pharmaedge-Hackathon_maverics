import { useRecords, type SourceRecord } from '@/features/assets/api'
import { cn } from '@/lib/utils'
import type { EventRecord } from '../api'
import { SheetSection } from './sheet-section'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const STATUS: Record<string, string> = { AP: 'Approved', TA: 'Tentative approval' }

function step(r: SourceRecord): string {
  const agency = r.collection === 'ema_records' ? 'EMA' : 'FDA'
  const type = str(r.submission_type)
  const kind = type === 'ORIG' ? 'Original' : str(r.submission_class) || (type === 'SUPPL' ? 'Supplement' : str(r.record_type).replace(/_/g, ' '))
  return [`${agency} submission`, kind].filter(Boolean).join(' · ')
}

function statusTone(s: string) {
  if (/approv|authoris|positive/i.test(s)) return 'bg-success-soft text-success'
  if (/review|expected|ongoing|pending/i.test(s)) return 'bg-primary-soft text-primary'
  if (/complete response|refus|withdraw/i.test(s)) return 'bg-danger-soft text-destructive'
  return 'bg-muted text-secondary-foreground'
}

/**
 * Every regulatory record of the same application (NDA / BLA), oldest first, this event's highlighted (README §6.4
 * "Regulatory path"). Reads the Regulatory tab's records filtered by application number; hidden below two steps.
 */
export function RegulatoryPath({ assetId, records, product }: { assetId: string; records: EventRecord[]; product?: string | null }) {
  const anchor = records.find((r) => (r.collection === 'fda_records' || r.collection === 'ema_records') && str(r.application_number))
  if (!anchor) return null
  return <PathFor assetId={assetId} application={str(anchor.application_number)} current={anchor.key} product={product} />
}

function PathFor({ assetId, application, current, product }: { assetId: string; application: string; current: string; product?: string | null }) {
  const records = useRecords(assetId, 'regulatory', { q: application, pageSize: 100 })
  const steps = (records.data?.items ?? []).filter((r) => r.application_number === application).sort((a, b) => (str(a.date) < str(b.date) ? -1 : str(a.date) > str(b.date) ? 1 : 0))
  if (steps.length < 2) return null
  // `q` is a substring search, so the total can include other applications: the count is exact only when every item on
  // the page belongs to this application (otherwise just say the list was cut off).
  const items = records.data?.items.length ?? 0
  const cut = (records.data?.total ?? 0) > items
  const more = cut && steps.length === items ? (records.data?.total ?? 0) - items : 0
  return (
    <SheetSection title={`Regulatory path · ${product || application}`}>
      <ol className="ml-[6px] border-l-2 border-hair">
        {steps.map((r) => {
          const status = STATUS[str(r.submission_status)] ?? str(r.submission_status)
          const here = r.key === current
          return (
            <li
              key={r.key}
              aria-current={here ? 'step' : undefined}
              className={cn(
                'relative flex items-center gap-[10px] py-[6px] pl-[14px] text-[12.5px] text-secondary-foreground',
                "before:absolute before:top-1/2 before:-left-[6px] before:-mt-[5px] before:size-[10px] before:rounded-full before:border-2 before:border-[#d0d5dd] before:bg-card before:content-['']",
                here && 'font-semibold text-foreground before:border-primary before:bg-primary',
              )}
            >
              <span className="min-w-[78px] font-mono text-[11.5px] font-normal text-muted-foreground">{str(r.date)}</span>
              <span className="min-w-0 flex-1">{step(r)}</span>
              {status && <span className={cn('rounded-md px-[6px] text-[11px] font-semibold whitespace-nowrap', statusTone(status))}>{status}</span>}
            </li>
          )
        })}
      </ol>
      {cut && <p className="mt-[6px] text-[11.5px] text-muted-foreground">{more > 0 ? `+${more} more records not shown` : 'More records not shown'}</p>}
    </SheetSection>
  )
}
