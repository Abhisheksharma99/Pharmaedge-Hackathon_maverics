import { Page } from './page'
import type { NavItem } from './nav-config'

/** Placeholder for sections whose data or crawlers are still being built (prototype `.soon` panel). */
export function ComingSoon({ item }: { item: NavItem }) {
  return (
    <Page title={item.label} description={item.detail ? item.summary : undefined}>
      <section className="flex flex-col items-center gap-[6px] rounded-[14px] border bg-card px-[24px] py-[56px] text-center shadow-panel">
        <span className="flex size-[48px] items-center justify-center rounded-[14px] border border-text-secondary bg-muted text-text-secondary">
          <item.icon className="size-[22px]" />
        </span>
        <h3 className="mt-[10px] text-[17px] font-semibold">Coming soon</h3>
        <p className="max-w-[440px] text-text-secondary">{item.detail ?? item.summary}</p>
      </section>
    </Page>
  )
}
