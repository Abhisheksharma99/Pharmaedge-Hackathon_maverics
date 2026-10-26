import { Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { byKindThenName, type AssetSummary } from '@/features/assets/api'
import { cn } from '@/lib/utils'
import { FOCUS } from '../controls'
import { COMPARE_COLORS } from './compare-layout'
import { compareHref, MAX_COMPARE } from './compare-url'

const rank = (ids: string[], id: string) => {
  const i = ids.indexOf(id)
  return i < 0 ? ids.length : i
}

/**
 * "Compare…": pick two or three tracked assets, then open their journeys on one time axis. The selection keeps its
 * order, which sets each journey's colour; `keep` carries the compare page's scope and indication over.
 */
export function ComparePicker({ assets, initial, keep, children }: { assets: AssetSummary[]; initial: string[]; keep?: URLSearchParams; children: ReactNode }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>(initial)
  // The assets picked when the dialog opened come first, so the defaults are in sight.
  const sorted = [...assets].sort((a, b) => rank(initial, a.id) - rank(initial, b.id) || byKindThenName(a, b))
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_COMPARE ? [...p, id] : p))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPicked(initial)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="min-[761px]:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">Compare journeys</DialogTitle>
          <DialogDescription>Pick two or three assets. Their journeys share one time axis, so the same years line up.</DialogDescription>
        </DialogHeader>
        <ul aria-label="Assets to compare" className="-mx-[4px] flex max-h-[320px] flex-col gap-[2px] overflow-y-auto px-[4px]">
          {sorted.map((a) => {
            const slot = picked.indexOf(a.id)
            const on = slot >= 0
            const full = !on && picked.length >= MAX_COMPARE
            return (
              <li key={a.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={full}
                  onClick={() => toggle(a.id)}
                  className={cn('flex w-full items-center gap-[10px] rounded-[10px] px-[10px] py-[7px] text-left hover:bg-accent disabled:opacity-45 disabled:hover:bg-transparent', FOCUS, on && 'bg-primary-soft hover:bg-primary-soft')}
                >
                  <span
                    aria-hidden="true"
                    className={cn('flex size-[16px] shrink-0 items-center justify-center rounded-[5px] border', on ? 'border-transparent text-white' : 'border-input bg-card')}
                    style={on ? { background: COMPARE_COLORS[slot] } : undefined}
                  >
                    {on && <Check className="size-[11px]" strokeWidth={3} />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate font-semibold">{a.name}</b>
                    <span className="truncate text-[12px] text-muted-foreground">{a.company.name}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-[6px] text-[10.5px] leading-[17px] font-semibold', a.kind === 'primary' ? 'bg-primary-soft text-primary' : 'bg-orange-soft text-competitor')}>
                    {a.kind === 'primary' ? 'Primary' : 'Competitor'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <DialogFooter className="items-center">
          <span className="mr-auto text-[12.5px] text-muted-foreground max-[760px]:hidden">{picked.length} of {MAX_COMPARE} picked</span>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={picked.length < 2}
            onClick={() => {
              setOpen(false)
              navigate(compareHref(picked, keep))
            }}
          >
            Compare {picked.length >= 2 ? picked.length : ''} journeys
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
