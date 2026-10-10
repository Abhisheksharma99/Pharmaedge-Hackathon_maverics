import { CardFilters } from '@/components/card-filters'

/**
 * The filter bar sits at the top of a card's body, flush with the card's own padding. Hidden to a "Filters" chip until
 * opened: in these small chart cards the open bar wraps to two or three rows above the chart.
 */
export function CardBar(props: Parameters<typeof CardFilters>[0]) {
  return <CardFilters defaultCollapsed {...props} className="px-0 pt-0 pb-[10px] max-[900px]:px-0" />
}

export const NoMatch = () => <p className="py-[24px] text-center text-[12px] text-muted-foreground">Nothing matches these filters.</p>
