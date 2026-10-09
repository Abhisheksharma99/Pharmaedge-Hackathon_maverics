import type { MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { CompetitorsOverview, Coverage, LandscapeRow } from '../../competitors-api'
import { Panel } from '../panel'
import { AssetAvatar } from './asset-avatar'
import { CollectingPill } from './collecting-pill'
import { shortIndication } from './utils'

const COVERAGE_LABEL: Record<Coverage, string> = { approved: 'Approved', investigational: 'Investigational', none: 'Not indicated' }

function CoverageDot({ value }: { value: Coverage }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'inline-block rounded-full align-middle',
          value === 'approved' && 'size-[12px] bg-primary',
          value === 'investigational' && 'size-[12px] border-2 border-[#7b8494]',
          value === 'none' && 'size-[5px] bg-input',
        )}
      />
      <span className="sr-only">{COVERAGE_LABEL[value]}</span>
    </>
  )
}

function Legend() {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-text-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-[10px] rounded-full bg-primary" />
        Approved
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-[10px] rounded-full border-2 border-[#7b8494]" />
        Investigational
      </span>
    </div>
  )
}

function Overlap({ shared, of }: LandscapeRow['overlap']) {
  return (
    <>
      <div className="font-semibold tabular-nums">
        {shared}
        <span className="font-normal text-muted-foreground"> / {of}</span>
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-center gap-0.5">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={cn('h-[4px] w-[8px] rounded-[2px]', i < shared ? 'bg-primary' : 'bg-border')} />
        ))}
      </div>
    </>
  )
}

/** Year of first approval on a shared axis, so early and late entrants read at a glance. */
function FirstApproval({ row, axis }: { row: LandscapeRow; axis: [number, number] | null }) {
  const year = row.firstApproval ? Number(row.firstApproval.slice(0, 4)) : null
  const pct = year && axis ? `${((year - axis[0]) / (axis[1] - axis[0])) * 100}%` : null
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono font-semibold">{year ?? '—'}</span>
        {row.approvalRegions.length > 0 && <span className="text-[12.5px] text-text-secondary">{row.approvalRegions.join(', ')}</span>}
      </div>
      {pct && (
        <div aria-hidden="true" className={cn('relative mt-[7px] h-[6px] rounded-[3px]', row.isReference ? 'bg-card' : 'bg-muted')}>
          <div className={cn('absolute inset-y-0 right-0 rounded-[3px]', row.isReference ? 'bg-[#a7b5f0]' : 'bg-input')} style={{ left: pct }} />
          <div
            className={cn(
              'absolute -top-[2px] -ml-[5px] size-[10px] rounded-full shadow-[0_0_0_2px_#fff]',
              row.isReference ? 'bg-primary' : 'bg-text-secondary',
            )}
            style={{ left: pct }}
          />
        </div>
      )}
    </>
  )
}

function approvalAxis(rows: LandscapeRow[]): [number, number] | null {
  const years = rows.flatMap((r) => (r.firstApproval ? [Number(r.firstApproval.slice(0, 4))] : []))
  if (!years.length) return null
  const to = Math.max(new Date().getFullYear(), ...years)
  const from = Math.min(Math.floor(Math.min(...years) / 5) * 5, to - 5)
  return [from, to]
}

/** Reference asset first, then competitors in rank order, with coverage of the reference's indications. */
export function LandscapeTable({ data }: { data: CompetitorsOverview }) {
  const navigate = useNavigate()
  const { reference, landscape } = data
  const indications = reference.indications
  const axis = approvalAxis(landscape)
  const open = (e: MouseEvent, id: string) => {
    if (!(e.target as HTMLElement).closest('a')) navigate(`/assets/${encodeURIComponent(id)}/overview`)
  }
  const head = 'h-auto text-[12px] font-semibold text-text-secondary'

  return (
    <Panel
      title="Competitive landscape"
      description={`Ranked by overlap with ${reference.name}. Hover a competitor to see why it was picked.`}
      actions={<Legend />}
    >
      <Table className="min-w-[820px] text-[13px]">
        <caption className="sr-only">
          {reference.name} and its competitors: mechanism, indication coverage, overlap and first approval
        </caption>
        <TableHeader>
          <TableRow
            className={cn(
              'bg-background hover:bg-background [&>th]:border-b [&>th]:border-[#eef0f3]',
              indications.length > 0 && 'border-b-0!',
            )}
          >
            <TableHead rowSpan={2} className={cn(head, 'py-2.5 pl-5')}>
              Asset
            </TableHead>
            <TableHead rowSpan={2} className={cn(head, 'py-2.5')}>
              Mechanism
            </TableHead>
            {indications.length > 0 && (
              <TableHead colSpan={indications.length} className={cn(head, 'border-b-0! pt-2.5 pb-0.5 text-center')}>
                Indication coverage
              </TableHead>
            )}
            <TableHead rowSpan={2} className={cn(head, 'py-2.5 text-center')}>
              Overlap
            </TableHead>
            <TableHead rowSpan={2} className={cn(head, 'w-[160px] py-2.5 pr-5')}>
              First approval
              {axis && (
                <div aria-hidden="true" className="mt-0.5 flex justify-between font-mono font-normal text-muted-foreground">
                  <span>{axis[0]}</span>
                  <span>{axis[1]}</span>
                </div>
              )}
            </TableHead>
          </TableRow>
          {indications.length > 0 && (
            <TableRow className="bg-background hover:bg-background">
              {indications.map((i) => (
                <TableHead key={i} className="h-auto min-w-[52px] px-1 pt-0.5 pb-2.5 text-center text-[12px] font-medium text-text-secondary">
                  <abbr title={i} className="no-underline">
                    {shortIndication(i)}
                  </abbr>
                </TableHead>
              ))}
            </TableRow>
          )}
        </TableHeader>
        <TableBody>
          {landscape.map((r) => {
            const collecting = !r.isReference && r.status === 'onboarding'
            return (
              <TableRow
                key={r.id}
                title={r.reason}
                onClick={(e) => open(e, r.id)}
                className={cn('cursor-pointer border-[#eef0f3]', r.isReference && 'bg-[#eef2fd] hover:bg-[#e6ebfc]')}
              >
                <TableCell className="py-3 pl-5">
                  <div className="flex items-center gap-3">
                    <AssetAvatar id={r.id} name={r.name} isReference={r.isReference} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link to={`/assets/${encodeURIComponent(r.id)}/overview`} className="text-[14px] font-semibold hover:underline">
                          {r.name}
                        </Link>
                        {collecting && <CollectingPill />}
                      </div>
                      <div className="text-[12.5px] text-text-secondary">
                        {r.company}
                        {r.isReference && (
                          <>
                            {' · '}
                            <span className="font-medium text-primary">This asset</span>
                          </>
                        )}
                        {r.otherIndications.length > 0 && (
                          <span title={r.otherIndications.join(', ')}>
                            {' · '}+{r.otherIndications.length} other {r.otherIndications.length === 1 ? 'indication' : 'indications'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  {r.mechanism ? (
                    <span
                      title={r.mechanism}
                      className={cn(
                        'inline-block h-[22px] max-w-[200px] truncate rounded-md px-2 align-middle text-[12px] leading-[22px] font-medium text-secondary-foreground',
                        r.isReference ? 'border bg-card leading-[20px]' : 'bg-muted',
                      )}
                    >
                      {r.mechanism}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                {indications.map((i) => (
                  <TableCell key={i} className="px-1 text-center" title={`${i}: ${COVERAGE_LABEL[r.coverage[i] ?? 'none']}`}>
                    <CoverageDot value={r.coverage[i] ?? 'none'} />
                  </TableCell>
                ))}
                <TableCell className="py-3 text-center">
                  {r.isReference ? <span className="text-[12px] text-text-secondary">Reference</span> : <Overlap {...r.overlap} />}
                </TableCell>
                <TableCell className="py-3 pr-5">
                  <FirstApproval row={r} axis={axis} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Panel>
  )
}
