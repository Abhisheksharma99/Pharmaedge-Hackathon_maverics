import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** A section whose data failed to load, with a retry. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[14px] border bg-card px-6 py-10 text-center">
      <p className="font-medium">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw /> Try again
      </Button>
    </div>
  )
}
