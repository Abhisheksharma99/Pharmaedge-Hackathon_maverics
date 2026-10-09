/** Marks an asset whose first crawl is still running. */
export function CollectingPill() {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-warning-soft px-2 text-[12px] font-semibold whitespace-nowrap text-warning">
      Collecting data
    </span>
  )
}
