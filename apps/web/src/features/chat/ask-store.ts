import { create } from 'zustand'

/** A question another view hands to the Asset AI panel ("Ask about this"): put in its composer, not sent. */
interface AskState {
  draft: { text: string; nonce: number } | null
  ask: (text: string) => void
}

export const useAskStore = create<AskState>((set) => ({
  draft: null,
  ask: (text) => set({ draft: { text, nonce: Date.now() } }),
}))
