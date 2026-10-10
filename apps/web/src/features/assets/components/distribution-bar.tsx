import { FOCUS } from '@/features/journey/controls'
import { cn } from '@/lib/utils'

/** Distribution bar colours, in order of share (prototype `tones`). */
const TONES = ['#2347d9', '#0b7a6f', '#e0620f', '#6941c6', '#98a2b3', '#5873e8', '#b42318']

/** Facet distribution: segmented bar plus a top-5 legend whose entries filter (prototype .rc-dist). */
export function DistributionBar({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string
  items: { value: string; label: string; count: number }[]
  selected: string | undefined
  onSelect: (value: string | undefined) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[8px] px-[20px] pt-[14px] pb-[4px]">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{label}</span>
      <span className="flex h-[8px] min-w-[160px] flex-[1_1_200px] gap-[2px] overflow-hidden rounded-[4px]">
        {items.map((v, i) => (
          <i
            key={v.value}
            title={`${v.label}: ${v.count}`}
            className="block transition-[flex-grow] duration-[400ms]"
            style={{ flexGrow: v.count, background: TONES[i % TONES.length] }}
          />
        ))}
      </span>
      <span className="flex flex-wrap gap-[4px]">
        {items.slice(0, 5).map((v, i) => {
          const on = selected === v.value
          return (
            <button
              key={v.value}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(on ? undefined : v.value)}
              className={cn(
                'inline-flex items-center gap-[6px] rounded-[6px] border px-[7px] py-[2px] text-[12px] text-secondary-foreground hover:bg-accent',
                FOCUS,
                on ? 'border-primary bg-primary-soft' : 'border-transparent',
              )}
            >
              <b className="size-[8px] rounded-[2px]" style={{ background: TONES[i % TONES.length] }} />
              {v.label}
              <em className="font-mono text-[11px] text-muted-foreground not-italic">{v.count}</em>
            </button>
          )
        })}
      </span>
    </div>
  )
}
