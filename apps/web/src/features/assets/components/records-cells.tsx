import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export const DASH = <span className="text-muted-foreground">—</span>

/** Status → tone, from the prototype's ST_TONE. */
function statusTone(s: string): 'ok' | 'run' | 'bad' | 'warn' | '' {
  if (/complet|approv|authoris|granted|ingest|positive/i.test(s) && !/complete response/i.test(s)) return 'ok'
  if (/recruit|active|expected|enrolling/i.test(s)) return 'run'
  if (/terminat|complete response|invalid|failed/i.test(s)) return 'bad'
  if (/review|ongoing|headline|litigation|asserted/i.test(s)) return 'warn'
  return ''
}
const TONE_CLASS = {
  ok: 'bg-success-soft text-success',
  run: 'bg-primary-soft text-primary',
  bad: 'bg-danger-soft text-destructive',
  warn: 'bg-warning-soft text-warning',
  '': 'bg-muted text-secondary-foreground',
}
export function StatusBadge({ value }: { value: string }) {
  if (!value) return DASH
  return (
    <span className={cn('inline-flex h-[20px] items-center rounded-[6px] px-[6px] text-[11.5px] font-semibold whitespace-nowrap', TONE_CLASS[statusTone(value)])}>
      {value}
    </span>
  )
}

export const Tag = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn('inline-block rounded-[5px] bg-muted px-[6px] py-[1px] text-[11px] whitespace-nowrap text-secondary-foreground', className)}>{children}</span>
)
export const Mono = ({ children, muted }: { children: ReactNode; muted?: boolean }) => (
  <span className={cn('font-mono text-[13px] whitespace-nowrap', muted && 'text-muted-foreground')}>{children}</span>
)

/** Triage decision pill (prototype .vd). */
const VERDICT = {
  ingest: ['Ingest', 'bg-success-soft text-success'],
  headline: ['Headline', 'bg-warning-soft text-warning'],
  skip: ['Skip', 'bg-muted text-muted-foreground'],
} as const
export function Verdict({ value }: { value: string }) {
  const [label, tone] = VERDICT[value as keyof typeof VERDICT] ?? [value, VERDICT.skip[1]]
  return <span className={cn('mr-[6px] inline-block rounded-[4px] px-[5px] text-[10.5px] leading-[16px] font-semibold', tone)}>{label}</span>
}

/** Records panel card: 14px radius, 20px gutters, 15px title (prototype .panel). */
export function RecordsCard({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-x-[24px] gap-y-[12px] px-[20px] pt-[18px] pb-[14px]">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {description && <p className="mt-[2px] text-pretty text-text-secondary">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="border-t border-hair">{children}</div>
    </section>
  )
}

/** The panel's 32px search field (prototype .as-q.sm). */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative max-w-[360px] min-w-[240px] flex-[1_1_240px]">
      <Search className="pointer-events-none absolute top-1/2 left-[12px] size-[14px] -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-[32px] rounded-[10px] border-border bg-card py-0 pr-[12px] pl-[34px] text-[13px] md:text-[13px]"
      />
    </div>
  )
}

export const TH = 'h-auto border-b border-border px-[14px] py-[9px] text-[12px] font-semibold text-text-secondary first:pl-[20px]'
export const TD = 'px-[14px] py-[11px] whitespace-normal first:pl-[20px]'
export const TR = 'animate-fade-up cursor-pointer border-b border-hair hover:bg-background'
