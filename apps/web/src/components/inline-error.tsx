import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

/** An in-panel load failure: the message in the existing tone plus a retry (README §9; Phase 7 error states). */
export function InlineError({ message, onRetry, className }: { message: string; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-wrap items-center gap-x-[12px] gap-y-[6px] p-[20px] text-destructive', className)}>
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-[5px] rounded-[4px] font-medium text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none"
      >
        <RefreshCw className="size-[12px]" aria-hidden="true" /> Try again
      </button>
    </div>
  )
}
