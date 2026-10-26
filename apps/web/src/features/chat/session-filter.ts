import type { ChatSession } from './api'

/** Sessions whose title (or asset name) contains every word of the query, case-insensitively. */
export function filterSessions(sessions: ChatSession[], query: string, assetName: (id: string) => string | undefined): ChatSession[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return sessions
  return sessions.filter((s) => {
    const hay = `${s.title || 'New chat'} ${s.assetId ? (assetName(s.assetId) ?? s.assetId) : ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
