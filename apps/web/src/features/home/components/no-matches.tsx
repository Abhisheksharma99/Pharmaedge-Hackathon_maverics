/** Shown under a card's filter bar when the filters leave nothing; the bar's Clear button resets them. */
export function NoMatches({ what = 'events' }: { what?: string }) {
  return <p className="px-[20px] py-[16px] text-center text-muted-foreground">No {what} match these filters</p>
}
