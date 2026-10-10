import { CalendarClock, FlaskConical, Landmark, Megaphone, Route } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { OverviewAnalytics } from '@/features/analytics/overview-analytics'
import { JourneySection } from '@/features/journey/journey-section'
import { LiveBuild } from '@/features/journey/live-build/live-build'
import { formatNumber } from '@/lib/format'
import { AdverseEventsChart } from '../components/adverse-events-chart'
import { EmptyState, KpiStrip, Panel } from '../components/panel'
import { RECORDS_CONFIG, type RecordsTabConfig } from '../components/records-config'
import { RecordsView } from '../components/records-view'
import { useAssetContext } from './asset-layout'

/** One records tab from its config: columns, facets, distribution bar, Journey column, onboarding state. */
function ConfiguredRecords({ config }: { config: RecordsTabConfig }) {
  const asset = useAssetContext()
  return (
    <RecordsView
      assetId={asset.id}
      tab={config.tab}
      title={config.title}
      description={config.description}
      searchPlaceholder={config.searchPlaceholder}
      columns={config.columns(asset)}
      facetLabel={config.facetLabel}
      toggle={config.toggle}
      step={config.step}
      onboarding={asset.status === 'onboarding'}
      journeyColumn
      showTotal={config.showTotal}
      storeTotal={asset.counts[config.countKey]}
    />
  )
}

export function OverviewTab() {
  const asset = useAssetContext()
  const [params, setParams] = useSearchParams()
  // "Explore the journey" leaves the live build even if the asset still reads as onboarding.
  const [exploredId, setExploredId] = useState<string | null>(null)
  // After "Explore the journey" its button is gone: hand focus to the Overview content.
  const focusJourney = useRef(false)
  const journeyRef = useCallback((node: HTMLDivElement | null) => {
    if (node && focusJourney.current) {
      focusJourney.current = false
      node.focus()
    }
  }, [])
  const { kpis, counts } = asset
  const journey = (
    <div ref={journeyRef} tabIndex={-1} className="flex flex-col gap-5 outline-none">
      <KpiStrip
        items={[
          {
            label: 'Approved in',
            icon: Landmark,
            value: kpis.approvalRegions.length ? kpis.approvalRegions.join(', ') : '—',
            hint: 'FDA and EMA authorisations',
          },
          { label: 'Active trials', icon: FlaskConical, value: formatNumber(kpis.activeTrials), hint: `${kpis.activePhase3} in Phase 3` },
          { label: 'Upcoming milestones', icon: CalendarClock, value: formatNumber(kpis.upcomingMilestones), hint: 'Trial readouts and patent expiries' },
          { label: 'Journey events', icon: Route, value: formatNumber(counts.events), hint: 'Regulatory, clinical, patent and company history' },
          { label: 'Company releases', icon: Megaphone, value: formatNumber(counts.pressReleases), hint: asset.company.name },
        ]}
      />
      <OverviewAnalytics asset={asset} />
      <JourneySection key={asset.id} asset={asset} />
    </div>
  )
  // A failed or cancelled crawl flips the asset to 'failed': show its build (it says why) when there is a job, else the journey.
  if (params.get('build') === '1' || ((asset.status === 'onboarding' || asset.status === 'failed') && exploredId !== asset.id)) {
    return (
      <LiveBuild
        key={asset.id}
        asset={asset}
        fallback={asset.status === 'failed' && params.get('build') !== '1' ? journey : undefined}
        onExplore={() => {
          focusJourney.current = true
          setExploredId(asset.id)
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev)
              next.delete('build')
              return next
            },
            { replace: true },
          )
        }}
      />
    )
  }
  return journey
}

export function ClinicalTab() {
  return <ConfiguredRecords config={RECORDS_CONFIG.clinical} />
}

export function RegulatoryTab() {
  const asset = useAssetContext()
  return (
    <div className="flex flex-col gap-5">
      <ConfiguredRecords config={RECORDS_CONFIG.regulatory} />
      <AdverseEventsChart assetId={asset.id} />
    </div>
  )
}

export { EvidenceTab } from './evidence-tab'

export function PublicationsTab() {
  return <ConfiguredRecords config={RECORDS_CONFIG.publications} />
}

export function ConferencesTab() {
  return <ConfiguredRecords config={RECORDS_CONFIG.conferences} />
}

export function DocumentsTab() {
  return <ConfiguredRecords config={RECORDS_CONFIG.documents} />
}

export function CompanyIrTab() {
  return <ConfiguredRecords config={RECORDS_CONFIG['company-ir']} />
}

export function SoonTab({ title, summary }: { title: string; summary: string }) {
  return (
    <Panel title={title}>
      <EmptyState title="Coming soon">{summary}</EmptyState>
    </Panel>
  )
}

export function PatentsTab() {
  return <ConfiguredRecords config={RECORDS_CONFIG.patents} />
}

export { CompetitorsTab } from './competitors-tab'
