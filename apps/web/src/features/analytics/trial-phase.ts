import { PHASE_COLORS } from '@/features/journey/constants'
import type { AnalyticsTrial } from './api'

const digits = (phase: string) => [...phase.matchAll(/\d/g)].map((m) => Number(m[0]))
const early = (phase: string) => /early/i.test(phase)

/** Sort position of a trial phase: Early Phase 1 < 1 < 1/2 < 2 < 2/3 < 3 < 4 < anything else (N/A, blank). */
export function phaseRank(phase: string): number {
  const n = digits(phase)
  if (!n.length) return Infinity
  return early(phase) ? n[0]! - 0.5 : (Math.min(...n) + Math.max(...n)) / 2
}

/** The group a phase falls in: "Phase 1", "Phase 1/2", "Early Phase 1", or "Other" for N/A. */
export function phaseGroup(phase: string): string {
  const n = digits(phase)
  if (!n.length) return 'Other'
  if (early(phase)) return `Early Phase ${n[0]}`
  const set = [...new Set(n)]
  return `Phase ${set.join('/')}`
}

/** Short bar tag: P3, P1/2, EP1. */
export const phaseTag = (phase: string): string => phaseGroup(phase).replace('Early Phase ', 'EP').replace('Phase ', 'P').replace('Other', '—')

/** Bar colour: a combined phase takes its later phase's colour. */
export const phaseColor = (phase: string): string => {
  const n = digits(phase)
  return (n.length && PHASE_COLORS[`Phase ${Math.max(...n)}`]) || '#98a2b3'
}

/** Trials ordered by phase, then by start date (undated last). */
export function sortTrialsByPhase<T extends Pick<AnalyticsTrial, 'phase' | 'start'>>(trials: T[]): T[] {
  return [...trials].sort(
    (a, b) => phaseRank(a.phase) - phaseRank(b.phase) || (a.start || '9999').localeCompare(b.start || '9999'),
  )
}
