import { ArrowRight, BookOpen, FlaskConical, Newspaper, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CompetitorsOverview, Count, EvidenceRow } from '../../competitors-api'
import { Panel } from '../panel'

const METRICS = [
  { key: 'trials', label: 'Clinical trials', icon: FlaskConical },
  { key: 'publications', label: 'Publications', icon: BookOpen },
  { key: 'regulatory', label: 'Regulatory events', icon: ShieldCheck },
  { key: 'news', label: 'News & abstracts', icon: Newspaper },
] as const

function Bar({ name, count, max, tone, collecting }: { name: string; count: Count; max: number; tone: string; collecting: boolean }) {
  const pending = collecting && count.total === 0
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_40px_44px] items-center gap-2.5">
      <div aria-hidden="true" className="h-[10px] rounded-[5px] bg-muted">
        <div className={cn('h-full rounded-[5px]', tone)} style={{ width: `${max ? (count.total / max) * 100 : 0}%` }} />
      </div>
      <span className="text-right font-semibold tabular-nums">
        <span className="sr-only">{name}: </span>
        {pending ? '—' : formatNumber(count.total)}
      </span>
      <span className="text-[12px] text-text-secondary tabular-nums">
        {!pending && (
          <>
            <span className="sr-only">, in the last 12 months </span>+{formatNumber(count.recent)}
          </>
        )}
      </span>
    </div>
  )
}

/** Evidence volume of the asset against one competitor, metric by metric. */
export function HeadToHead({ data }: { data: CompetitorsOverview }) {
  const reference = data.evidence.find((e) => e.id === data.reference.id)
  const rivals = data.evidence.filter((e) => e.id !== data.reference.id)
  const [selected, setSelected] = useState<string | null>(null)
  const rival = rivals.find((r) => r.id === selected) ?? rivals[0]
  if (!reference || !rival) return null

  const rowOf = (e: EvidenceRow) => data.landscape.find((r) => r.id === e.id)
  const collecting = rowOf(rival)?.status === 'onboarding'

  return (
    <Panel
      title="Head-to-head evidence"
      description="Records collected per asset; + counts the last 12 months"
      className="flex flex-col"
      bodyClassName="flex flex-1 flex-col"
      actions={
        <Select value={rival.id} onValueChange={setSelected}>
          <SelectTrigger aria-label="Compare with" className="h-9 rounded-[10px] font-medium">
            <span className="text-muted-foreground">vs</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rivals.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 pt-3 text-[12.5px] text-text-secondary">
        {[
          { e: reference, tone: 'bg-primary' },
          { e: rival, tone: 'bg-orange' },
        ].map(({ e, tone }) => (
          <span key={e.id} className="inline-flex items-center gap-1.5">
            <span className={cn('size-[10px] rounded-[3px]', tone)} />
            <span className="font-medium text-foreground">{e.name}</span>
            {rowOf(e)?.company}
          </span>
        ))}
      </div>
      <div className="flex flex-col px-5 pt-1 pb-2">
        {METRICS.map((m) => {
          const max = Math.max(reference[m.key].total, rival[m.key].total)
          return (
            <div
              key={m.key}
              className="grid grid-cols-[128px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-[#eef0f3] py-3 not-first:border-t"
            >
              <div className="row-span-2 flex items-center gap-2 font-medium text-secondary-foreground">
                <m.icon className="size-[15px] text-muted-foreground" />
                {m.label}
              </div>
              <Bar name={reference.name} count={reference[m.key]} max={max} tone="bg-primary" collecting={false} />
              <Bar name={rival.name} count={rival[m.key]} max={max} tone="bg-orange" collecting={collecting} />
            </div>
          )
        })}
      </div>
      <div className="mt-auto border-t border-[#eef0f3] px-5 py-3">
        <Link
          to={`/assets/${encodeURIComponent(rival.id)}/evidence`}
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
        >
          {rival.name} evidence <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </Panel>
  )
}
