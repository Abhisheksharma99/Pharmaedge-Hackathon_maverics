import { AlertCircle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Why a turn ended early (error or stopped), with Retry. Partial text stays above it. */
export function TurnStatus({ status, error, onRetry }: { status: 'error' | 'stopped'; error: string | null; onRetry: () => void }) {
  const failed = status === 'error'
  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={
        failed
          ? 'flex flex-wrap items-center gap-[8px] rounded-lg border border-destructive/20 bg-danger-soft px-[12px] py-[8px] text-destructive'
          : 'flex flex-wrap items-center gap-[8px] text-muted-foreground'
      }
    >
      {failed && <AlertCircle className="size-[16px] shrink-0" />}
      <span className="min-w-0 flex-1">{failed ? error : 'Stopped.'}</span>
      <Button variant="outline" size="sm" onClick={onRetry} className="bg-card">
        <RotateCw /> Retry
      </Button>
    </div>
  )
}
