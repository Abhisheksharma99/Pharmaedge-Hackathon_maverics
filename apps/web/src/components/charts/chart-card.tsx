import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { CardDataContext, ChartExpanded, type CardData } from './card-data'
import { CardMenu } from './card-menu'

const SPAN: Record<1 | 2 | 3 | 4, string> = {
  1: '',
  2: 'min-[701px]:col-span-2',
  3: 'min-[701px]:col-span-2 min-[1181px]:col-span-3',
  4: 'min-[701px]:col-span-2 min-[1181px]:col-span-4',
}

/** Chart grid: 4 columns, 2 at ≤1180px, 1 at ≤700px. */
export function ChartGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-[16px] min-[701px]:grid-cols-2 min-[1181px]:grid-cols-4', className)}>{children}</div>
  )
}

/** Where a card's charts report their series: kept in a ref, read when the menu opens. */
function useReportedData() {
  const ref = useRef<CardData | null>(null)
  const report = useCallback((d: CardData | null) => {
    ref.current = d
  }, [])
  return [ref, report] as const
}

/** The card's chart full-screen, with its own filter bar and the same downloads (of what the dialog shows). */
function ExpandedCard({ title, description, subject, onClose, children }: { title: string; description?: string; subject: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const [data, report] = useReportedData()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={root}
        className="flex h-[calc(100dvh-32px)] w-full flex-col gap-0 p-0 min-[761px]:h-[calc(100dvh-64px)] min-[761px]:max-w-[min(1280px,calc(100vw-64px))]"
      >
        <div className="flex items-start gap-[10px] border-b border-hair py-[14px] pr-[52px] pl-[20px]">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[15px] leading-[20px] font-semibold">{title}</DialogTitle>
            <DialogDescription className={cn('mt-[2px] text-[12.5px] text-muted-foreground', !description && 'sr-only')}>
              {description ?? `${title}, expanded`}
            </DialogDescription>
          </div>
          <CardMenu title={title} subject={subject} root={root} data={data} />
        </div>
        <div className="@container min-h-0 flex-1 overflow-auto px-[20px] pt-[14px] pb-[20px]">
          <ChartExpanded value>
            <CardDataContext value={report}>{children}</CardDataContext>
          </ChartExpanded>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * White chart card; a container-query context so charts adapt to the card, not the viewport. With `menu` it carries the
 * "⋯" menu (Expand, Download image, Download data), fed by what its chart reports through `useCardData`.
 */
export function ChartCard({
  title,
  description,
  span = 1,
  actions,
  menu,
  children,
  className,
}: {
  title: string
  description?: string
  span?: 1 | 2 | 3 | 4
  actions?: ReactNode
  /** The asset the card is about, for the downloads' caption and file names. */
  menu?: { subject: string }
  children: ReactNode
  className?: string
}) {
  const root = useRef<HTMLElement>(null)
  const [data, report] = useReportedData()
  const [expanded, setExpanded] = useState(false)
  return (
    <section
      ref={root}
      aria-label={title}
      className={cn(
        '@container flex min-w-0 animate-fade-up flex-col rounded-[14px] border bg-card shadow-panel',
        SPAN[span],
        className,
      )}
    >
      <div className="flex justify-between gap-[10px] px-[16px] pt-[14px] pb-[4px]">
        <div className="min-w-0">
          <h4 className="text-[13.5px] font-semibold">{title}</h4>
          {description && <p className="mt-[2px] text-[12px] text-muted-foreground">{description}</p>}
        </div>
        {menu ? (
          <div className="-mt-[3px] -mr-[6px] flex shrink-0 items-start gap-[2px]">
            <CardMenu title={title} subject={menu.subject} root={root} data={data} onExpand={() => setExpanded(true)} />
            {actions}
          </div>
        ) : (
          actions
        )}
      </div>
      <div className="relative flex-1 px-[16px] pt-[8px] pb-[14px]">
        {menu ? <CardDataContext value={report}>{children}</CardDataContext> : children}
      </div>
      {menu && expanded && (
        <ExpandedCard title={title} description={description} subject={menu.subject} onClose={() => setExpanded(false)}>
          {children}
        </ExpandedCard>
      )}
    </section>
  )
}
