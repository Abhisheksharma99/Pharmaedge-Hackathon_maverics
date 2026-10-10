import { useCardFilter } from '@/components/card-filters'
import { Gantt } from '@/components/charts/gantt'
import { HBars } from '@/components/charts/h-bars'
import { Heat } from '@/components/charts/heat'
import { VBars } from '@/components/charts/v-bars'
import { BRANCH_PALETTE, PHASE_COLORS } from '@/features/journey/constants'
import { relativeFuture, yearFraction } from '@/lib/dates'
import { formatMonth } from '@/lib/format'
import type { AnalyticsBlocks, AnalyticsLandscapeRow } from './api'
import { CardBar, NoMatch } from './card-bar'
import { enrolmentByIndication, pipelineFacets, pipelineText, trialFacets, trialText, yearOf } from './card-filter-defs'
import { MilestoneList } from './milestone-list'
import { PipelineMatrix } from './pipeline-matrix'
import type { Milestone } from './templates'
import { phaseColor, phaseGroup, phaseTag, sortTrialsByPhase } from './trial-phase'

export function PipelineBody({ rows }: { rows: AnalyticsBlocks['pipeline'] }) {
  const { filtered, filters } = useCardFilter(rows, pipelineText, pipelineFacets)
  return (
    <>
      <CardBar {...filters} placeholder="Search indications" />
      {filtered.length ? <PipelineMatrix rows={filtered} /> : <NoMatch />}
    </>
  )
}

export function MilestonesBody({ items }: { items: Milestone[] }) {
  const { filtered, filters } = useCardFilter(items, (m) => m.title, [{ label: 'Indication', of: (m) => m.indications ?? [] }])
  return (
    <>
      <CardBar {...filters} placeholder="Search milestones" />
      {filtered.length ? (
        <MilestoneList
          items={filtered.slice(0, 4).map((e) => ({
            key: e.id,
            month: formatMonth(e.date).split(' ')[0]!,
            year: e.date.slice(0, 4),
            title: e.title,
            sub: relativeFuture(e.date),
            indications: e.indications,
          }))}
        />
      ) : (
        <NoMatch />
      )}
    </>
  )
}

export function TrialsPhaseBody({ trials }: { trials: AnalyticsBlocks['trials'] }) {
  const { filtered, filters } = useCardFilter(trials, trialText, trialFacets('Indication', 'Status'))
  return (
    <>
      <CardBar {...filters} placeholder="Search trials" />
      <VBars
        h={110}
        data={['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map((p) => ({
          l: p.replace('Phase ', 'P'),
          v: filtered.filter((t) => t.phase === p).length,
          c: PHASE_COLORS[p],
        }))}
      />
    </>
  )
}

export function EnrolBody({ trials }: { trials: AnalyticsBlocks['trials'] }) {
  const { filtered, filters } = useCardFilter(trials, trialText, trialFacets('Phase', 'Status'))
  const data = enrolmentByIndication(filtered)
  return (
    <>
      <CardBar {...filters} placeholder="Search trials" />
      {data.length ? (
        <HBars data={data.map(([l, v], i) => ({ l, v, c: BRANCH_PALETTE[i % BRANCH_PALETTE.length] }))} />
      ) : (
        <NoMatch />
      )}
    </>
  )
}

export function TrialsBody({ trials }: { trials: AnalyticsBlocks['trials'] }) {
  const { filtered, filters } = useCardFilter(trials, trialText, trialFacets('Indication', 'Phase', 'Status'))
  // The axis covers every trial so the bars keep their place while filtering.
  const from = Math.min(...trials.map((t) => yearOf(t.start)))
  const to = Math.max(...trials.map((t) => yearOf(t.pcd || t.start))) + 1
  return (
    <>
      <CardBar {...filters} placeholder="Search trials" />
      {filtered.length ? (
        <Gantt
          from={from}
          to={to}
          rows={sortTrialsByPhase(filtered).map((t) => ({
            l: t.name,
            sub: t.indication,
            s: yearFraction(t.start),
            e: yearFraction(t.pcd || t.start),
            c: phaseColor(t.phase),
            tag: phaseTag(t.phase),
            dash: /terminat/i.test(t.status),
            group: phaseGroup(t.phase),
          }))}
        />
      ) : (
        <NoMatch />
      )}
    </>
  )
}

export function LandscapeBody({ landscape }: { landscape: AnalyticsBlocks['landscape'] }) {
  const covered = (r: AnalyticsLandscapeRow) => landscape.cols.filter((c) => r.cells[c] && r.cells[c] !== 'none')
  const { filtered, filters } = useCardFilter(landscape.rows, (r) => `${r.name} ${r.company ?? ''}`, [{ label: 'Indication', of: covered }])
  const picked = filters.selects[0]?.value
  return (
    <>
      <CardBar {...filters} placeholder="Search assets" />
      {filtered.length ? (
        <Heat
          cols={picked ? [picked] : landscape.cols}
          rows={filtered.map((r) => ({
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
      ) : (
        <NoMatch />
      )}
    </>
  )
}
