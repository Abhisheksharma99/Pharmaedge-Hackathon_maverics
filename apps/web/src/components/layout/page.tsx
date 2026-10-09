import type { ReactNode } from 'react'

/** Standard page frame: title row (with optional actions) and content. */
export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-text-secondary">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  )
}
