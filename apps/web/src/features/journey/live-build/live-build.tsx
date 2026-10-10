import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { InlineError } from '@/components/inline-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { AssetDetail } from '@/features/assets/api'
import { EmptyState, Panel } from '@/features/assets/components/panel'
import { recordsTotal } from '@/features/jobs/job-counters'
import { ActivityLog } from './activity-log'
import { AgentPipeline, PipelineLegend } from './agent-pipeline'
import { buildPhase } from './build-model'
import { BuildStrip } from './build-strip'
import { FormingTimeline } from './forming-timeline'
import { JustAdded } from './just-added'
import { useLiveBuild } from './use-live-build'

/**
 * The asset Overview while its journey is being built (README §6.1, screen 31): build strip, agent pipeline, "Journey
 * taking shape" with "Just added", and the activity log, all driven by the asset's newest crawl job.
 */
export function LiveBuild({ asset, onExplore, fallback }: { asset: AssetDetail; onExplore: () => void; fallback?: ReactNode }) {
  const build = useLiveBuild(asset)
  // `fallback` (the journey): shown instead of anything but a build with a job to show.
  if (fallback && build.state !== 'ready') return fallback
  const explore = (
    <Button variant="outline" size="sm" onClick={onExplore}>
      Explore the journey <ArrowRight className="size-[13px]" />
    </Button>
  )

  if (build.state === 'loading') {
    return (
      <div className="flex flex-col gap-[20px]">
        <Skeleton className="h-[118px] rounded-[14px]" />
        <Skeleton className="h-[520px] rounded-[14px]" />
      </div>
    )
  }
  if (build.state === 'error') {
    return (
      <Panel title="Live build" actions={explore}>
        <InlineError message="The live build couldn't be loaded." onRetry={build.retry} className="px-[20px] py-[16px]" />
      </Panel>
    )
  }
  if (build.state === 'none' || !build.job) {
    return (
      <Panel title="Live build" actions={explore}>
        <EmptyState title="No crawl yet">Use “Refresh data” to collect this asset’s sources and watch its journey being built.</EmptyState>
      </Panel>
    )
  }

  const { job, events, latest, feed } = build
  const running = buildPhase(job) !== 'done'
  return (
    <div className="flex animate-fade-up flex-col gap-[20px]">
      <BuildStrip job={job} eventsCount={events.length} onExplore={onExplore} />
      <Panel
        title="Agent pipeline"
        description="Source agents collect records into the store; rules and AI turn them into dated journey events."
        actions={<PipelineLegend />}
      >
        <AgentPipeline job={job} events={events} competitors={asset.competitors.map((c) => c.name)} />
      </Panel>
      <div className="grid items-stretch gap-[20px] min-[1181px]:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Journey taking shape" description="Records land as ticks on the time axis; events crystallise in their lane as rules and AI find them.">
          <FormingTimeline recordYears={job.record_years} recordCount={recordsTotal(job)} events={events} />
          <JustAdded latest={latest} total={events.length} ended={!running} />
        </Panel>
        <Panel
          title="Activity"
          description={running ? 'Live from the crawl worker' : `${feed.length} entries`}
          className="flex flex-col"
          bodyClassName="relative min-h-[360px] flex-1"
        >
          <ActivityLog items={feed} steps={job.steps} startedAt={job.started_at} running={running} />
        </Panel>
      </div>
    </div>
  )
}
