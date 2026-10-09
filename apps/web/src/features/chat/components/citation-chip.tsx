import type { Citation } from '../api'

const CHIP = 'mx-px inline-flex h-4 min-w-4 items-center justify-center rounded px-1 align-super text-[10.5px] leading-none font-semibold'

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
        className={`${CHIP} bg-[#eef2fd] text-primary hover:bg-primary hover:text-primary-foreground`}
      >
        {n}
      </button>
    </sup>
  )
}
