import { Suspense, type ComponentType } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Page } from './page'

function PageFallback() {
  return (
    <div role="status" aria-label="Loading" className="space-y-[16px] p-[24px]">
      <Skeleton className="h-[28px] w-[220px]" />
      <Skeleton className="h-[16px] w-[360px] max-w-full" />
      <Skeleton className="h-[240px] w-full rounded-[14px]" />
    </div>
  )
}

/** A lazily loaded page behind its own Suspense, so the layout around it stays on screen while it loads. */
export function LazyPage({ component: Lazy }: { component: ComponentType }) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Lazy />
    </Suspense>
  )
}

export function NotFound() {
  return (
    <Page title="Page not found">
      <p className="text-text-secondary">This page doesn't exist. Use the navigation to find what you need.</p>
    </Page>
  )
}
