import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { JourneyView } from './journey-model'

/** Loading placeholder shaped like the journey it stands in for: the pinned track's lane and alternating cards, or the tree's trunk with cards either side. */
export function JourneySkeleton({ view }: { view: JourneyView }) {
  if (view === 'v') {
    return (
      <div role="status" aria-label="Loading the journey" className="relative mt-[20px] flex flex-col gap-[28px] py-[8px]">
        <span aria-hidden="true" className="absolute top-0 bottom-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-border max-[979px]:left-[14px]" />
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start', 'max-[979px]:justify-end')}>
            <Skeleton className="h-[150px] w-[44%] rounded-2xl max-[979px]:w-[calc(100%-40px)]" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div role="status" aria-label="Loading the journey" className="relative mt-[20px] h-[min(70vh,520px)] overflow-hidden rounded-[14px] border bg-card">
      <span aria-hidden="true" className="absolute top-1/2 right-0 left-0 h-[4px] -translate-y-1/2 bg-border" />
      {[8, 30, 52, 74].map((left, i) => (
        <Skeleton key={left} className={cn('absolute h-[96px] w-[20%] rounded-[14px]', i % 2 ? 'top-[calc(50%+24px)]' : 'bottom-[calc(50%+24px)]')} style={{ left: `${left}%` }} />
      ))}
    </div>
  )
}
