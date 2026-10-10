import type { Ref } from 'react'
import type { BranchModel, Closure } from './journey-model'
import type { NoteDraft } from './note-composer'
import type { JourneyEventV3 } from './types'

/** What JourneySection can ask a view (horizontal track or tree) to do. */
export interface JourneyViewHandle {
  /** Scroll to the event and flash its card; false when the view doesn't show it. */
  jump: (id: string) => boolean
}

/** Props shared by both journey views. */
export interface JourneyViewProps {
  assetId: string
  /** Filtered events, oldest first, or newest first when `newestFirst`. */
  list: JourneyEventV3[]
  /** `list` runs newest first: the track starts at the latest event on the left, the tree at the top. */
  newestFirst?: boolean
  model: BranchModel
  closures: Record<string, Closure>
  stars: string[]
  comments: Record<string, unknown[]>
  focusBranch: string | null
  onOpen: (id: string) => void
  onAdd: (draft: NoteDraft) => void
  /** Optional: index of the active event within the view's dated events (`list` without undated ones, same order). */
  onActive?: (index: number) => void
  ref?: Ref<JourneyViewHandle>
}
