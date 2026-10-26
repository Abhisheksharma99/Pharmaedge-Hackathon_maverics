import { byKindThenName, type AssetSummary } from '@/features/assets/api'

/** Up to this many journeys side by side. */
export const MAX_COMPARE = 3
const SLOTS = ['a', 'b', 'c'] as const

/** `/journey/compare?a=…&b=…[&c=…]`, keeping `extra` params (scope, indication). */
export function compareHref(ids: string[], extra?: URLSearchParams): string {
  const p = new URLSearchParams()
  ids.slice(0, MAX_COMPARE).forEach((id, i) => p.set(SLOTS[i]!, id))
  for (const k of ['scope', 'ind']) {
    const v = extra?.get(k)
    if (v) p.set(k, v)
  }
  return `/journey/compare?${p}`
}

/** The compared asset ids, in slot order (a, b, c), without repeats. */
export const compareIds = (params: URLSearchParams): string[] => [...new Set(SLOTS.flatMap((k) => params.get(k) || []))]

/** The asset and its first competitor (a primary's first tracked competitor; a competitor's first primary). */
export function defaultCompare(asset: AssetSummary, all: AssetSummary[]): string[] {
  const other =
    asset.kind === 'primary'
      ? [...all].sort(byKindThenName).find((a) => a.competitorOf.some((p) => p.id === asset.id))?.id
      : asset.competitorOf.find((p) => all.some((a) => a.id === p.id))?.id
  return other ? [asset.id, other] : [asset.id]
}
