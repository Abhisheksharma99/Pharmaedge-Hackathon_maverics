import { formatDate } from '@/lib/format'
import type { SourceRecord } from '../api'

export const isSlide = (r: SourceRecord) => r.record_type === 'presentation_slide'

const COUNT = /^(number of (subjects|patients|participants)|n|sample size|enrol+ment)$/i

/** Week 4 < Week 52; Baseline first; unknown last. */
function when(t?: string | null): number {
  if (!t) return Number.MAX_SAFE_INTEGER
  if (/baseline/i.test(t)) return -1
  const n = /(\d+(?:\.\d+)?)/.exec(t)
  return n ? Number(n[1]) : Number.MAX_SAFE_INTEGER - 1
}

/** Outcomes before head-counts; then by measure (slide order), arm and timepoint. */
export function orderFigures<T extends { metric: string; arm?: string | null; timepoint?: string | null }>(ms: T[]): T[] {
  const first = new Map<string, number>()
  ms.forEach((m, i) => first.has(m.metric) || first.set(m.metric, i))
  return [...ms].sort(
    (a, b) =>
      Number(COUNT.test(a.metric)) - Number(COUNT.test(b.metric)) ||
      first.get(a.metric)! - first.get(b.metric)! ||
      (a.arm ?? '').localeCompare(b.arm ?? '') ||
      when(a.timepoint) - when(b.timepoint),
  )
}

/** Title and subtitle for the sheet header. */
export function slideHeading(r: SourceRecord): { title: string; subtitle: string } {
  const deck = (r.deck_title as string) || 'Investor presentation'
  return {
    title: (r.slide_title as string) || `Slide ${r.page}`,
    subtitle: [deck, r.page ? `slide ${r.page}` : '', formatDate(r.date as string)].filter(Boolean).join(' · '),
  }
}
