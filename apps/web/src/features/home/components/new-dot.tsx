import { cn } from '@/lib/utils'

/** The "New since your last visit" marker on a Home row; `className` aligns it (e.g. to a title's first line). */
export function NewDot({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="New since your last visit" title="New since your last visit" className={cn('relative inline-flex size-[8px] shrink-0 rounded-full bg-primary', className)}>
      <i aria-hidden="true" className="absolute inset-[-3px] rounded-full bg-primary/20" />
    </span>
  )
}
