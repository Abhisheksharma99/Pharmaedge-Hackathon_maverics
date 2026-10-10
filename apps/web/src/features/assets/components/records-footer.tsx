import { formatNumber } from '@/lib/format'

/** "Showing x of y", plus "· N in the record store" only when the store holds more than is available. */
export function RecordsFooter({ shown, available, storeTotal }: { shown: number; available: number; storeTotal?: number }) {
  return (
    <div className="border-t border-hair px-[20px] py-[12px] text-muted-foreground">
      {`Showing ${formatNumber(shown)} of ${formatNumber(available)}${storeTotal !== undefined && storeTotal > available ? ` · ${formatNumber(storeTotal)} in the record store` : ''}`}
    </div>
  )
}
