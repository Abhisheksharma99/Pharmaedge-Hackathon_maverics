import { Activity, CalendarDays, Database, Pill, Route } from 'lucide-react'
import { useAssets } from '@/features/assets/api'
import { KpiStrip, type Kpi } from '@/features/assets/components/panel'
import { useAuth } from '@/features/auth/auth-context'
import { useJobs, type Job } from '@/features/jobs/api'
import { jobProgress } from '@/features/jobs/steps'
import { todayIso } from '@/lib/dates'
import { formatNumber } from '@/lib/format'
import { usePortfolioTimeline } from './api'
import { AskCard } from './components/ask-card'
import { CompetitiveSignals } from './components/competitive-signals'
import { CrawlsCard } from './components/crawls-card'
import { HomeHero } from './components/home-hero'
import { NextMilestones } from './components/next-milestones'
import { PortfolioTimeline } from './components/portfolio-timeline'
import { TrackedAssets } from './components/tracked-assets'
import { WhatChanged } from './components/what-changed'
import { homeCounts } from './home-data'

const pct = (job: Job) => Math.round(jobProgress(job) * 100)

/** Home dashboard (README §5.2). */
export function HomePage() {
  const { user } = useAuth()
  const assets = useAssets()
  const portfolio = usePortfolioTimeline()
  const runningJobs = useJobs({ status: 'running' })

  const firstName = user?.name.split(' ')[0] ?? ''
  const all = assets.data ?? []
  const primary = all.filter((a) => a.kind === 'primary').length
  const competitors = all.length - primary
  const counts = portfolio.data ? homeCounts(portfolio.data.events, todayIso()) : null
  const running = runningJobs.data ?? []
  const onboarding = running.find((j) => j.type === 'onboard')
  const records = all.reduce(
    (sum, a) => sum + a.counts.trials + a.counts.regulatory + a.counts.pressReleases + a.counts.documents + a.counts.news + a.counts.publications + a.counts.conferences + a.counts.patents,
    0,
  )
  const rival = all.find((a) => a.kind === 'competitor' && a.competitorOf.length > 0)

  const kpis: Kpi[] = [
    { label: 'Tracked assets', icon: Pill, value: assets.data ? primary : '—', hint: assets.data ? `${competitors} competitor${competitors === 1 ? '' : 's'} monitored` : undefined },
    { label: 'New events', icon: Route, value: counts ? counts.new90 : '—', hint: 'Last 90 days, across all assets' },
    { label: 'Upcoming milestones', icon: CalendarDays, value: counts ? counts.next12m : '—', hint: 'Next 12 months' },
    { label: 'Records collected', icon: Database, value: assets.data ? formatNumber(records) : '—', hint: 'FDA, EMA, trials, PubMed, news' },
    {
      label: 'Crawls running',
      icon: Activity,
      value: runningJobs.data ? running.length : '—',
      hint: running[0] ? `${running[0].assetName ?? running[0].asset} · ${pct(running[0])}%` : 'Nothing running',
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[20px] px-[24px] pt-[20px] pb-[48px] max-[900px]:px-[14px] max-[900px]:pt-[16px] max-[900px]:pb-[40px]">
      <HomeHero firstName={firstName} counts={counts} loading={portfolio.isPending} building={onboarding ? { name: onboarding.assetName ?? onboarding.asset, pct: pct(onboarding) } : null} />
      <KpiStrip items={kpis} />
      <PortfolioTimeline />
      <div className="grid items-start gap-[20px] min-[1100px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <WhatChanged />
        <div className="flex min-w-0 flex-col gap-[20px]">
          <NextMilestones />
          <CrawlsCard />
        </div>
      </div>
      <TrackedAssets />
      <div className="grid items-start gap-[20px] min-[1100px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <CompetitiveSignals />
        <AskCard compare={rival ? [rival.competitorOf[0].name, rival.name] : null} />
      </div>
    </div>
  )
}
