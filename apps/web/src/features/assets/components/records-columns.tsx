import { ChevronDown, Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BTN_SM } from '@/features/journey/controls'
import type { Density } from './records-prefs'

const ITEM = 'rounded-[8px] py-[6px] pl-[10px] text-[13px]'
const LABEL = 'px-[10px] pt-[6px] pb-[4px] text-[11.5px] font-semibold tracking-[0.04em] text-muted-foreground uppercase'

/**
 * A records table's "Columns" menu: show or hide each column (the last visible one stays) and pick the row density.
 * The menu stays open while ticking, so several columns change in one go.
 */
export function RecordsColumnsMenu({
  headers,
  hidden,
  onHidden,
  density,
  onDensity,
}: {
  headers: string[]
  hidden: string[]
  onHidden: (hidden: string[]) => void
  density: Density
  onDensity: (d: Density) => void
}) {
  const shown = headers.filter((h) => !hidden.includes(h))
  const nHidden = headers.length - shown.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={BTN_SM} aria-label={nHidden ? `Columns, ${nHidden} hidden` : 'Columns'}>
          <Columns3 aria-hidden="true" />
          Columns
          {nHidden > 0 && <span className="rounded-full bg-muted px-[6px] text-[11.5px] font-semibold text-text-secondary tabular-nums">{shown.length}/{headers.length}</span>}
          <ChevronDown className="-mr-[2px] size-[13px] text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} collisionPadding={16} className="max-h-[min(480px,var(--radix-dropdown-menu-content-available-height))] w-[248px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[12px] border border-border p-[6px] shadow-popover ring-0">
        <DropdownMenuLabel className={LABEL}>Columns</DropdownMenuLabel>
        {headers.map((h) => {
          const on = !hidden.includes(h)
          return (
            <DropdownMenuCheckboxItem
              key={h}
              className={ITEM}
              checked={on}
              disabled={on && shown.length === 1}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(next) => onHidden(next ? hidden.filter((x) => x !== h) : [...hidden, h])}
            >
              {h}
            </DropdownMenuCheckboxItem>
          )
        })}
        {nHidden > 0 && (
          <DropdownMenuItem
            className={`${ITEM} font-medium text-primary focus:text-primary`}
            onSelect={(e) => {
              e.preventDefault()
              onHidden([])
            }}
          >
            Show all columns
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator className="mx-[-6px] my-[6px]" />
        <DropdownMenuLabel className={LABEL}>Density</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={density} onValueChange={(v) => onDensity(v as Density)}>
          <DropdownMenuRadioItem value="comfortable" className={ITEM} onSelect={(e) => e.preventDefault()}>
            Comfortable
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact" className={ITEM} onSelect={(e) => e.preventDefault()}>
            Compact
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
