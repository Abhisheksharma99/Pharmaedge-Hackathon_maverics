import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { daysBetween } from '@/lib/dates'
import type { EventDetail } from '../api'
import { BranchChip } from '../chips'
import { gapLabel, laneOf, lineage, type BranchModel } from '../journey-model'
import type { JourneyEventV3 } from '../types'

/** "PAH › PH-ILD › IPF" and where the event sits on its branch (README §6.4 "Branch"). Nothing without branches. */
export function BranchLineage({ event, model, stats }: { event: JourneyEventV3; model: BranchModel; stats: EventDetail['branchStats'] }) {
  if (!model.multi) return null
  const lane = model.byId.get(laneOf(event, model))!
  const chain = lineage(lane.id, model)
  const prev = stats.prevSameBranch
  const gap = prev ? `, ${gapLabel(Math.abs(daysBetween(prev.date, event.date)))} after “${prev.title}”` : ''
  return (
    <>
      <div className="flex flex-wrap items-center gap-[6px]">
        {chain.map((b, i) => (
          <Fragment key={b.id}>
            {i > 0 && <ChevronRight className="size-[12px] text-muted-foreground" aria-hidden="true" />}
            <BranchChip branch={b} current={b.id === lane.id} />
          </Fragment>
        ))}
      </div>
      <p className="mt-[8px] text-[12.5px] leading-normal text-text-secondary">
        {[lane.full, lane.status].filter(Boolean).join(' · ')}.{stats.index > 0 && ` Event ${stats.index} of ${stats.total} on this branch${gap}.`}
      </p>
    </>
  )
}
