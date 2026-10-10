import { Skeleton } from '@/components/ui/skeleton'

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-[8px] p-[20px]">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[40px] w-full" />
      ))}
    </div>
  )
}
