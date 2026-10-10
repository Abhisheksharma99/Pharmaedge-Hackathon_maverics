import { Check, Loader2, Minus } from 'lucide-react'
import type { ToolActivity } from '../turn-store'

/**
 * What Asset AI is doing while it answers, e.g. "Searching evidence: TETON results ✓ 8 passages".
 * Tools still open when the turn ended (error / stopped) show as not finished.
 */
export function ToolActivityList({ tools, streaming }: { tools: ToolActivity[]; streaming: boolean }) {
  return (
    <ul aria-label="Asset AI activity" className="flex flex-col items-start gap-[6px]">
      {tools.map((t) => (
        <li key={t.id} className="inline-flex items-center gap-[6px] rounded-[8px] border border-hair bg-background px-[9px] py-[4px] text-[12px] text-text-secondary">
          {t.summary !== null ? (
            <Check aria-label="Done" strokeWidth={2.6} className="size-[13px] shrink-0 text-success" />
          ) : streaming ? (
            <Loader2 aria-label="Running" className="size-[13px] shrink-0 animate-spin text-primary" />
          ) : (
            <Minus aria-label="Not finished" className="size-[13px] shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 truncate">{t.label}</span>
          {t.summary && <span className="shrink-0 text-muted-foreground">· {t.summary}</span>}
        </li>
      ))}
    </ul>
  )
}
