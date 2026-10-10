import type { ReactNode } from 'react'
import { Donut } from '@/components/charts/donut'
import { StackBars } from '@/components/charts/stack-bars'
import { CATEGORY_META, SIGNIFICANCE_COLORS, collectionMeta } from '@/features/journey/constants'
import type { EventCategory } from '@/features/journey/types'
import { todayIso } from '@/lib/dates'
import type { AnalyticsBlocks } from './api'
import { enrolmentByIndication, mergeSafety, yearOf } from './card-filter-defs'
import { EnrolBody, LandscapeBody, MilestonesBody, PipelineBody, TrialsBody, TrialsPhaseBody } from './template-bodies'

export interface OvTemplate {
  title: string
  description?: string
  span: 1 | 2 | 4
  /** Shown in the library as "Indexed · {basis}". */
  basis: string
  /** Whether the blocks hold what this card needs; a card that can't be drawn is hidden. */
  requires: (b: AnalyticsBlocks) => boolean
  render: (b: AnalyticsBlocks) => ReactNode
}

export interface Milestone {
  id: string
  title: string
  date: string
  /** The pipeline indication it belongs to, when known. */
  indications?: string[]
}

/** Next expected dates across branches (plus the headline catalyst), soonest first. */
export function nextMilestones(b: AnalyticsBlocks): Milestone[] {
  const byId = new Map<string, Milestone>()
  for (const r of b.pipeline ?? []) if (r.next) byId.set(r.next.id, { ...r.next, indications: [r.label] })
  const c = b.stats?.nextCatalyst
  if (c && !byId.has(c.id)) byId.set(c.id, c)
  const today = todayIso()
  for (const p of b.patents ?? []) {
    if (!p.invalidated && p.expiry >= today)
      byId.set(`patent:${p.number}`, {
        id: `patent:${p.number}`,
        title: `Patent ${p.number} expires`,
        date: p.expiry,
      })
  }
  return [...byId.values()].sort((x, z) => x.date.localeCompare(z.date))
}

const sum = (o: object) => Object.values(o as Record<string, number>).reduce((s, n) => s + n, 0)

export const OV_TEMPLATES: Record<string, OvTemplate> = {
  pipeline: {
    title: 'Development pipeline',
    description: 'Furthest stage per indication',
    span: 2,
    basis: 'trials, filings, approvals',
    requires: (b) => b.pipeline?.length > 0,
    render: (b) => <PipelineBody rows={b.pipeline} />,
  },
  activity: {
    title: 'Journey activity by year',
    description: 'Events per year by category',
    span: 2,
    basis: 'journey events',
    requires: (b) => b.activityByYear?.cols.length > 0,
    render: (b) => {
      const { cols } = b.activityByYear
      return (
        <StackBars
          h={120}
          cols={cols}
          every={cols.length > 16 ? 3 : 1}
          series={mergeSafety(b.activityByYear).series.map((s) => ({
            ...s,
            c: CATEGORY_META[s.k as EventCategory]?.color ?? '#98a2b3',
          }))}
        />
      )
    },
  },
  milestones: {
    title: 'Next milestones',
    description: 'Expected readouts, decisions and expiries',
    span: 1,
    basis: 'trial dates, FDA calendar, patents',
    requires: (b) => nextMilestones(b).length > 0,
    render: (b) => <MilestonesBody items={nextMilestones(b)} />,
  },
  sig: {
    title: 'Significance mix',
    span: 1,
    basis: 'journey events',
    requires: (b) => !!b.significance && sum(b.significance) > 0,
    render: (b) => (
      <Donut
        size={120}
        sub="events"
        data={(['High', 'Medium', 'Low'] as const).map((s) => ({
          l: s,
          v: b.significance[s],
          c: SIGNIFICANCE_COLORS[s],
        }))}
      />
    ),
  },
  trialsPhase: {
    title: 'Trials by phase',
    span: 1,
    basis: 'ClinicalTrials.gov records',
    requires: (b) => b.trials?.length > 0,
    render: (b) => <TrialsPhaseBody trials={b.trials} />,
  },
  enrol: {
    title: 'Enrolment by indication',
    span: 1,
    basis: 'ClinicalTrials.gov records',
    requires: (b) => b.trials?.length > 0 && enrolmentByIndication(b.trials).length > 0,
    render: (b) => <EnrolBody trials={b.trials} />,
  },
  trials: {
    title: 'Clinical trial timeline',
    span: 2,
    basis: 'ClinicalTrials.gov records',
    requires: (b) => b.trials?.some((t) => t.company && yearOf(t.start) > 1900) ?? false,
    render: (b) => <TrialsBody trials={b.trials.filter((t) => t.company && yearOf(t.start) > 1900)} />,
  },
  sources: {
    title: 'Source mix',
    span: 1,
    basis: 'stored records',
    requires: (b) => b.sourceMix?.length > 0,
    render: (b) => (
      <Donut
        size={120}
        sub="records"
        data={b.sourceMix.map((s) => ({
          l: collectionMeta(s.coll).label,
          v: s.n,
          c: collectionMeta(s.coll).color,
        }))}
      />
    ),
  },
  landscape: {
    title: 'Competitive landscape',
    span: 2,
    basis: 'competitor journeys',
    requires: (b) => b.landscape?.cols.length > 0 && b.landscape.rows.length > 1,
    render: (b) => <LandscapeBody landscape={b.landscape} />,
  },
}

/** Pinned cards before you change anything: trial data → the full set, otherwise the light one. */
export const defaultKeys = (b: AnalyticsBlocks | undefined) =>
  b?.trials?.length ? ['pipeline', 'milestones', 'activity', 'trialsPhase', 'enrol'] : ['activity', 'milestones', 'sig']
