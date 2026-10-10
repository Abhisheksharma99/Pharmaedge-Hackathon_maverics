/** Date chip + title list (Next milestones card, calendar results). */
export function MilestoneList({
  items,
}: {
  items: {
    key: string
    month: string
    year: string
    title: string
    sub: string
  }[]
}) {
  return (
    <ul className="flex flex-col">
      {items.map((e) => (
        <li key={e.key} className="flex items-center gap-[10px] border-b border-hair py-[7px] last:border-b-0">
          <span className="flex w-[40px] shrink-0 flex-col items-center rounded-[8px] border py-[2px] leading-[1.2]">
            <b className="text-[10.5px] font-bold text-primary uppercase">{e.month}</b>
            <span className="text-[11.5px] font-semibold">{e.year}</span>
          </span>
          <span className="flex min-w-0 flex-col text-[12.5px] font-medium">
            {e.title}
            <em className="text-[11.5px] font-semibold text-primary not-italic">{e.sub}</em>
          </span>
        </li>
      ))}
    </ul>
  )
}
