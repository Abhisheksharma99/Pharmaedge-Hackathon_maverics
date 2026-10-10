import { Sparkle } from 'lucide-react'

/** The sparkle avatar in front of every Asset AI answer (prototype `.ai-mark`). */
export function AssistantMark() {
  return (
    <span aria-hidden="true" className="flex size-[28px] shrink-0 items-center justify-center rounded-[9px] bg-violet-soft text-violet">
      <Sparkle className="size-[14px]" />
    </span>
  )
}
