import { Fragment, type ReactNode } from 'react'

export interface HeatCell {
  label: ReactNode
  bg: string
  fg: string
  t?: string
}

/** Row × column matrix (competitive landscape, congress × year). */
export function Heat<R extends { l: string; sub?: string }>({
  rows,
  cols,
  cell,
}: {
  rows: R[]
  cols: string[]
  cell: (row: R, col: string) => HeatCell
}) {
  return (
    // Narrow screens scroll the matrix sideways instead of the page (the columns keep their 64px minimum).
    <div className="overflow-x-auto">
      <div
        className="grid gap-[3px] text-[12px]"
        style={{ gridTemplateColumns: `minmax(110px,160px) repeat(${cols.length}, minmax(64px,1fr))` }}
      >
        <span />
        {cols.map((c) => (
          <span key={c} className="pb-[2px] text-center text-[11px] font-semibold text-text-secondary">
            {c}
          </span>
        ))}
        {rows.map((r) => (
          <Fragment key={r.l}>
            <span className="flex min-w-0 flex-col justify-center leading-tight">
              <b className="font-medium">{r.l}</b>
              {r.sub && <em className="truncate text-[10.5px] text-muted-foreground not-italic">{r.sub}</em>}
            </span>
            {cols.map((c) => {
              const x = cell(r, c)
              return (
                <span
                  key={c}
                  title={x.t}
                  className="flex h-[30px] animate-fade items-center justify-center rounded-[6px] text-[11.5px] font-semibold"
                  style={{ background: x.bg, color: x.fg }}
                >
                  {x.label}
                </span>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
