import type { FilterFacet } from '@/components/card-filters'
import { shortIndication } from '@/features/assets/components/competitors/utils'
import { STAGES } from '@/features/journey/constants'
import type { AnalyticsBlocks, AnalyticsTrial, AssetAnalytics, PipelineRow } from './api'
import { phaseGroup } from './trial-phase'

export const trialText = (t: AnalyticsTrial) => `${t.name} ${t.title} ${t.nct} ${t.indication}`
export const trialFacets = (...labels: ('Indication' | 'Phase' | 'Status')[]): FilterFacet<AnalyticsTrial>[] => {
  const all: Record<string, FilterFacet<AnalyticsTrial>> = {
    Indication: { label: 'Indication', of: (t) => (t.indication ? [shortIndication(t.indication)] : []) },
    Phase: { label: 'Phase', of: (t) => [phaseGroup(t.phase)] },
    Status: { label: 'Status', of: (t) => (t.status ? [statusLabel(t.status)] : []) },
  }
  return labels.map((l) => all[l]!)
}

export const pipelineText = (r: PipelineRow) => `${r.label} ${r.full}`
export const pipelineFacets: FilterFacet<PipelineRow>[] = [
  { label: 'Indication', of: (r) => [r.label] },
  { label: 'Stage', of: (r) => [STAGES[Math.min(Math.max(r.stage, 0), STAGES.length - 1)]!] },
]

/** "ACTIVE_NOT_RECRUITING" → "Active, not recruiting". */
export const statusLabel = (v: string) => {
  const s = v.toLowerCase().replace(/_/g, ' ').replace(/^active not/, 'active, not')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Merge a leftover `safety` series into `clinical` (the two are one category). */
export function mergeSafety(a: AssetAnalytics['activityByYear']): AssetAnalytics['activityByYear'] {
  const safety = a.series.find((s) => s.k === 'safety')
  if (!safety) return a
  const rest = a.series.filter((s) => s.k !== 'safety')
  const clinical = rest.find((s) => s.k === 'clinical')
  if (!clinical) return { cols: a.cols, series: rest.concat({ ...safety, k: 'clinical', l: 'Clinical' }) }
  return { cols: a.cols, series: rest.map((s) => (s === clinical ? { ...s, vals: s.vals.map((v, i) => v + (safety.vals[i] ?? 0)) } : s)) }
}

export const yearOf = (iso: string) => Number(iso.slice(0, 4))

export function enrolmentByIndication(trials: AnalyticsBlocks['trials']) {
  const m = new Map<string, number>()
  for (const t of trials) if (t.indication && t.enrollment) m.set(shortIndication(t.indication), (m.get(shortIndication(t.indication)) ?? 0) + t.enrollment)
  return [...m].sort((x, z) => z[1] - x[1]).slice(0, 6)
}
