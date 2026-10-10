import { create } from 'zustand'
import type { Chapter, Story, StoryNote, StorySpec } from './api'

/**
 * Stories Asset AI is building right now, assembled from the streamed layers (chat events story_start /
 * story_layer). The story view draws each layer as it arrives; `layers` keeps their arrival order for the reveal.
 */
export interface LiveStory {
  assetId: string
  title: string
  question: string | null
  spec: StorySpec
  story: Partial<Story> & { lanes: Story['lanes'] }
  notes: StoryNote[]
  chapterNames: Record<string, string>
  layers: string[]
  building: boolean
}

interface LiveStoryState {
  live: Record<string, LiveStory>
  start: (storyId: string, s: Pick<LiveStory, 'assetId' | 'title' | 'question' | 'spec'>) => void
  layer: (storyId: string, layer: string, data: unknown) => void
  finish: (storyId: string) => void
  drop: (storyId: string) => void
}

export const useLiveStories = create<LiveStoryState>((set) => ({
  live: {},
  start: (storyId, s) =>
    set((st) => ({ live: { ...st.live, [storyId]: { ...s, story: { lanes: [] }, notes: [], chapterNames: {}, layers: [], building: true } } })),
  layer: (storyId, layer, data) =>
    set((st) => {
      const cur = st.live[storyId]
      if (!cur) return st
      const story = { ...cur.story }
      let { notes, chapterNames } = cur
      if (layer === 'axis') Object.assign(story, data as Pick<Story, 'range' | 'asset' | 'counts'>)
      else if (layer === 'approvals') story.approvals = data as Story['approvals']
      else if (layer === 'market') story.market = data as Story['market']
      else if (layer === 'lane') story.lanes = [...story.lanes, data as Story['lanes'][number]]
      else if (layer === 'changes') story.changes = data as Story['changes']
      else if (layer === 'compare') story.compare = data as Story['compare']
      else if (layer === 'chapters') story.chapters = data as Chapter[]
      else if (layer === 'notes') ({ notes, chapterNames } = data as { notes: StoryNote[]; chapterNames: Record<string, string> })
      return { live: { ...st.live, [storyId]: { ...cur, story, notes, chapterNames, layers: [...cur.layers, layer] } } }
    }),
  finish: (storyId) => set((st) => (st.live[storyId] ? { live: { ...st.live, [storyId]: { ...st.live[storyId]!, building: false } } } : st)),
  drop: (storyId) =>
    set((st) => {
      const { [storyId]: _gone, ...rest } = st.live
      return { live: rest }
    }),
}))
