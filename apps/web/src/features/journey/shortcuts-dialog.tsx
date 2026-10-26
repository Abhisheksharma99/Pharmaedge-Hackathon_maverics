import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SHORTCUTS } from './use-journey-keys'

/** "?" on the journey: the keyboard shortcuts. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-[761px]:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold">Keyboard shortcuts</DialogTitle>
          <DialogDescription>On the journey, whenever you aren’t typing in a field.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-[12px] border-b border-hair py-[7px] last:border-b-0">
              <dt className="text-secondary-foreground">{s.label}</dt>
              <dd className="flex shrink-0 items-center gap-[4px]">
                {s.keys.map((k, i) => (
                  <span key={k} className="flex items-center gap-[4px]">
                    {i > 0 && <span className="text-[11.5px] text-muted-foreground">or</span>}
                    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-b-2 bg-muted px-[6px] font-mono text-[11.5px] font-semibold text-foreground">{k}</kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
