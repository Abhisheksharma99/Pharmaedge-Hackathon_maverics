import type { Citation } from '../api'

const CHIP = 'mx-px inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-[4px] px-[4px] align-super text-[10.5px] leading-none font-semibold'

/** A "[n]" marker: opens the cited record; plain when the answer has no such citation (yet). */
export function CitationChip({ n, citation, onOpen }: { n: number; citation?: Citation; onOpen: (c: Citation) => void }) {
  if (!citation) return <sup className={`${CHIP} bg-muted text-muted-foreground`}>{n}</sup>
  return (
    <sup>
      <button
        type="button"
        onClick={() => onOpen(citation)}
        title={citation.title}
        aria-label={`Source ${n}: ${citation.title}`}
        className={`${CHIP} bg-primary-soft text-primary hover:bg-primary hover:text-primary-foreground`}
      >
        {n}
      </button>
    </sup>
  )
}
