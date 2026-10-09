import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { EventCategory, Significance } from '@/features/assets/api'

export interface Signal {
  id: string
  assetId: string
  assetName: string
  kind: 'primary' | 'competitor' | null
  date: string
  title: string
  type: string
  category: EventCategory
  significance: Significance
  sources: { collection: string; record_key: string }[]
}

/** Latest high-significance moves and the next milestones across every tracked asset. */
export function useSignals() {
  return useQuery({ queryKey: ['signals'], queryFn: () => apiFetch<{ recent: Signal[]; upcoming: Signal[] }>('/signals') })
}
