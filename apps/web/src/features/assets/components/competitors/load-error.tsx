import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** A section whose data failed to load, with a retry. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-[12px] rounded-[14px] border bg-card px-[24px] py-[40px] text-center">
      <p className="font-medium">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw /> Try again
      </Button>
    </div>
  )
}
