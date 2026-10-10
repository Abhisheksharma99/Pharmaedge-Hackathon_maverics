import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  if (total <= pageSize) return null
  const pages = Math.ceil(total / pageSize)
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center justify-between border-t border-hair px-[20px] py-[12px] text-text-secondary">
      <span>
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex gap-[6px]">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
