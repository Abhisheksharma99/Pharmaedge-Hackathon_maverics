import { Sparkle } from 'lucide-react'

/** The sparkle avatar in front of every Asset AI answer. */
export function AssistantMark() {
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#eef2fd]">
      <Sparkle className="size-[15px] fill-primary text-primary" />
    </span>
  )
}
