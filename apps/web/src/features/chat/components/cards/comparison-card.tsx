import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Card } from '../../api'

type ComparisonCardData = Extract<Card, { type: 'comparison' }>

const assetPath = (id: string, tab: string) => `/assets/${encodeURIComponent(id)}/${tab}`
const isNumber = (v: string) => /^[\d.,]+$/.test(v.trim())

/** Side-by-side table of the reference asset and its competitor(s), with links onward. */
export function ComparisonCard({ card }: { card: ComparisonCardData }) {
  const [reference, other] = card.columns
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-[12.5px] leading-[1.4]">
          <caption className="sr-only">{card.title}</caption>
          <thead>
            <tr className="bg-[#f9fafb]">
              <th scope="col" className="w-[30%] px-2.5 py-2 text-left">
                <span className="sr-only">Attribute</span>
              </th>
              {card.columns.map((col, i) => (
                <th key={col.id} scope="col" className="px-2.5 py-2 text-left font-semibold text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={cn('size-2 rounded-[2px]', i === 0 ? 'bg-primary' : 'bg-orange')} />
                    {col.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="border-t border-[#eef0f3] px-2.5 py-2 text-left align-top font-medium text-text-secondary">
                  {row.label}
                </th>
                {row.values.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      'border-t border-[#eef0f3] px-2.5 py-2 align-top text-foreground',
                      isNumber(v) && 'font-semibold tabular-nums',
                    )}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reference && (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-9 rounded-[10px] border-input bg-card px-3 text-[13px]">
            <Link to={assetPath(reference.id, 'evidence')}>
              View evidence <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-9 rounded-[10px] border-input bg-card px-3 text-[13px]">
            <Link to={assetPath(reference.id, 'competitors')}>
              Compare journeys <ArrowRight />
            </Link>
          </Button>
        </div>
      )}
      {other && (
        <Link
          to={assetPath(other.id, 'overview')}
          className="inline-flex w-max items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
        >
          Open {other.name} <ArrowUpRight className="size-3.5" />
        </Link>
      )}
    </div>
  )
}
