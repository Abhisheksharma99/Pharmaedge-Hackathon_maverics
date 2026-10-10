import { formatDate } from '@/lib/format'
import type { Citation } from '../api'

/** Numbered list of the records an answer cites; each opens in the record sheet. */
export function SourcesList({ citations, onOpen }: { citations: Citation[]; onOpen: (c: Citation) => void }) {
  return (
    <div className="space-y-[4px]">
      <p className="text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Sources</p>
      <ol>
        {[...citations]
          .sort((a, b) => a.n - b.n)
          .map((c) => (
            <li key={c.n}>
              <button
                type="button"
                onClick={() => onOpen(c)}
                className="flex w-full items-start gap-[8px] rounded-lg px-[6px] py-[4px] text-left hover:bg-accent/60"
              >
                <span className="mt-[2px] inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-[4px] bg-primary-soft px-[4px] text-[10.5px] font-semibold text-primary">
                  {c.n}
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 font-medium text-foreground">{c.title}</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {[c.source, formatDate(c.date), c.assetName].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
      </ol>
    </div>
  )
}
