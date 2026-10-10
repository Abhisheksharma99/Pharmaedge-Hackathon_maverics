import type { ReactNode } from 'react'

/** A titled block of the event sheet: 11px uppercase label, 20px above. */
export function SheetSection({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-[20px]">
      <h3 className="mb-[8px] text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {title}
        {extra && <span className="font-mono tracking-normal normal-case">{extra}</span>}
      </h3>
      {children}
    </section>
  )
}
