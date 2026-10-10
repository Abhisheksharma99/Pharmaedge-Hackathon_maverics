import type { ReactNode } from 'react'
import { Donut } from '@/components/charts/donut'
import { Gantt } from '@/components/charts/gantt'
import { HBars } from '@/components/charts/h-bars'
import { Heat } from '@/components/charts/heat'
import { StackBars } from '@/components/charts/stack-bars'
import { VBars } from '@/components/charts/v-bars'
import { shortIndication } from '@/features/assets/components/competitors/utils'
import { BRANCH_PALETTE, CATEGORY_META, PHASE_COLORS, SIGNIFICANCE_COLORS, collectionMeta } from '@/features/journey/constants'
import type { EventCategory } from '@/features/journey/types'
import { relativeFuture, todayIso, yearFraction } from '@/lib/dates'
import { formatMonth } from '@/lib/format'
import type { AnalyticsBlocks } from './api'
import { MilestoneList } from './milestone-list'
import { PipelineMatrix } from './pipeline-matrix'

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

/** Next expected dates across branches (plus the headline catalyst), soonest first. */
export function nextMilestones(b: AnalyticsBlocks) {
  const byId = new Map<string, { id: string; title: string; date: string }>()
  for (const r of b.pipeline ?? []) if (r.next) byId.set(r.next.id, r.next)
  if (b.stats?.nextCatalyst) byId.set(b.stats.nextCatalyst.id, b.stats.nextCatalyst)
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
const yearOf = (iso: string) => Number(iso.slice(0, 4))

function enrolmentByIndication(b: AnalyticsBlocks) {
  const m = new Map<string, number>()
  for (const t of b.trials) if (t.indication && t.enrollment) m.set(shortIndication(t.indication), (m.get(shortIndication(t.indication)) ?? 0) + t.enrollment)
  return [...m].sort((x, z) => z[1] - x[1]).slice(0, 6)
}

export const OV_TEMPLATES: Record<string, OvTemplate> = {
  pipeline: {
    title: 'Development pipeline',
    description: 'Furthest stage per indication',
    span: 2,
    basis: 'trials, filings, approvals',
    requires: (b) => b.pipeline?.length > 0,
    render: (b) => <PipelineMatrix rows={b.pipeline} />,
  },
  activity: {
    title: 'Journey activity by year',
    description: 'Events per year by category',
    span: 2,
    basis: 'journey events',
    requires: (b) => b.activityByYear?.cols.length > 0,
    render: (b) => {
      const { cols, series } = b.activityByYear
      return (
        <StackBars
          h={120}
          cols={cols}
          every={cols.length > 16 ? 3 : 1}
          series={series.map((s) => ({
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
    render: (b) => (
      <MilestoneList
        items={nextMilestones(b)
          .slice(0, 4)
          .map((e) => ({
            key: e.id,
            month: formatMonth(e.date).split(' ')[0]!,
            year: e.date.slice(0, 4),
            title: e.title,
            sub: relativeFuture(e.date),
          }))}
      />
    ),
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
    render: (b) => (
      <VBars
        h={110}
        data={['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map((p) => ({
          l: p.replace('Phase ', 'P'),
          v: b.trials.filter((t) => t.phase === p).length,
          c: PHASE_COLORS[p],
        }))}
      />
    ),
  },
  enrol: {
    title: 'Enrolment by indication',
    span: 1,
    basis: 'ClinicalTrials.gov records',
    requires: (b) => b.trials?.length > 0 && enrolmentByIndication(b).length > 0,
    render: (b) => (
      <HBars
        data={enrolmentByIndication(b).map(([l, v], i) => ({
          l,
          v,
          c: BRANCH_PALETTE[i % BRANCH_PALETTE.length],
        }))}
      />
    ),
  },
  trials: {
    title: 'Clinical trial timeline',
    span: 2,
    basis: 'ClinicalTrials.gov records',
    requires: (b) => b.trials?.some((t) => t.company && yearOf(t.start) > 1900) ?? false,
    render: (b) => {
      const ts = b.trials.filter((t) => t.company && yearOf(t.start) > 1900).sort((x, z) => x.start.localeCompare(z.start))
      const ends = ts.map((t) => yearOf(t.pcd || t.start))
      return (
        <Gantt
          from={yearOf(ts[0]!.start)}
          to={Math.max(...ends) + 1}
          rows={ts.map((t) => ({
            l: t.name,
            sub: t.indication,
            s: yearFraction(t.start),
            e: yearFraction(t.pcd || t.start),
            c: PHASE_COLORS[t.phase] ?? '#98a2b3',
            tag: t.phase.replace('Phase ', 'P'),
            dash: /terminat/i.test(t.status),
          }))}
        />
      )
    },
  },
  patents: {
    title: 'Patent runway',
    span: 2,
    basis: 'patent records',
    requires: (b) => b.patents?.some((p) => p.granted && p.expiry) ?? false,
    render: (b) => {
      const ps = b.patents.filter((p) => p.granted && p.expiry)
      return (
        <Gantt
          from={Math.floor(Math.min(...ps.map((p) => yearOf(p.granted))) / 4) * 4}
          to={Math.ceil((Math.max(...ps.map((p) => yearOf(p.expiry))) + 1) / 4) * 4}
          rows={ps.map((p) => ({
            l: p.number,
            sub: p.title,
            s: yearFraction(p.granted),
            e: yearFraction(p.expiry),
            c: p.invalidated ? '#b42318' : p.expired ? '#98a2b3' : '#6941c6',
            dash: p.invalidated,
            tag: p.expiry.slice(0, 4),
          }))}
        />
      )
    },
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
    render: (b) => (
      <Heat
        cols={b.landscape.cols}
        rows={b.landscape.rows.map((r) => ({
          ...r,
          l: r.name,
          sub: r.me ? 'this asset' : (r.company ?? undefined),
        }))}
        cell={(r, c) =>
          r.cells[c] === 'approved'
            ? { label: 'Approved', bg: '#e6f4f2', fg: '#0b7a6f' }
            : r.cells[c] === 'investigational'
              ? { label: 'In trials', bg: '#fffaeb', fg: '#b54708' }
              : { label: '—', bg: '#f9fafb', fg: '#98a2b3' }
        }
      />
    ),
  },
}

/** Pinned cards before you change anything: trial data → the full set, otherwise the light one. */
export const defaultKeys = (b: AnalyticsBlocks | undefined) =>
  b?.trials?.length ? ['pipeline', 'milestones', 'activity', 'trialsPhase', 'enrol'] : ['activity', 'milestones', 'sig']
