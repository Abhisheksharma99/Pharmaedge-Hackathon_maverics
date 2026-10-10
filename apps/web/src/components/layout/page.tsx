import type { ReactNode } from 'react'

/** Standard page frame (prototype `.page` + `.pg-h`): optional crumb, title row (with optional actions) and content, 20px apart. */
export function Page({
  title,
  description,
  actions,
  crumb,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  crumb?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[20px] px-[24px] pt-[20px] pb-[48px] max-[900px]:px-[14px] max-[900px]:pt-[16px] max-[900px]:pb-[40px]">
      {crumb}
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <h1 className="text-[24px] leading-[30px] font-[650] tracking-[-0.02em]">{title}</h1>
          {description && <p className="mt-[3px] text-text-secondary">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  )
}
