import { Page } from './page'
import type { NavItem } from './nav-config'

/** Placeholder for sections whose data or crawlers are still being built. */
export function ComingSoon({ item }: { item: NavItem }) {
  return (
    <Page title={item.label}>
      <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-16 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-accent text-text-secondary">
          <item.icon className="size-5" />
        </span>
        <p className="font-medium">Coming soon</p>
        <p className="mt-1 max-w-md text-text-secondary">{item.summary}</p>
      </div>
    </Page>
  )
}
