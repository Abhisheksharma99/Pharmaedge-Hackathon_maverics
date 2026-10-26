import { CalendarDays, Pill, Route } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAssets } from '@/features/assets/api'
import { KpiStrip, type Kpi } from '@/features/assets/components/panel'
import { useAuth } from '@/features/auth/use-auth'
import { useJobs, type Job } from '@/features/jobs/api'
import { jobProgress } from '@/features/jobs/steps'
import { useHomeWatchlistOnly, useSavePrefs, useWatchlist } from '@/features/me/api'
import { todayIso } from '@/lib/dates'
import { usePortfolioTimeline } from './api'
import { AskCard } from './components/ask-card'
import { CompetitiveSignals } from './components/competitive-signals'
import { CrawlsCard } from './components/crawls-card'
import { HomeHero } from './components/home-hero'
import { NextMilestones } from './components/next-milestones'
import { PortfolioTimeline } from './components/portfolio-timeline'
import { SinceBanner } from './components/since-banner'
import { TrackedAssets } from './components/tracked-assets'
import { WatchlistChip } from './components/watchlist-chip'
import { WHAT_CHANGED_ID, WhatChanged } from './components/what-changed'
import { formatVisit, homeCounts, newSince, scopePortfolio } from './home-data'
import { HomeScopeContext } from './home-scope'

const pct = (job: Job) => Math.round(jobProgress(job) * 100)

/** Records this Home visit; resolves to the previous visit (ISO) that "new" is measured from, or null on a first visit. */
function useHomeVisit(): string | null {
  const { mutate, data } = useSavePrefs()
  useEffect(() => mutate({ lastSeen: { home: new Date().toISOString() } }), [mutate])
  return data?.lastSeen?.homePrev ?? null
}

/** Home dashboard (README §5.2). */
export function HomePage() {
  const { user } = useAuth()
  const assets = useAssets()
  const portfolio = usePortfolioTimeline()
  const runningJobs = useJobs({ status: 'running' })
  const since = useHomeVisit()
  const watchlist = useWatchlist()
  const [watchOnly, setWatchOnly] = useHomeWatchlistOnly()
  const [showNew, setShowNew] = useState(false)
  // Read once per mount (react purity: no Date calls during render).
  const [now] = useState(() => new Date())

  const firstName = user?.name.split(' ')[0] ?? ''
  const all = assets.data ?? []
  // Stars of assets that still exist; the chip only filters when there is at least one.
  const starred = watchlist.ids.filter((id) => all.some((a) => a.id === id))
  const watched = watchOnly && starred.length > 0 ? new Set(starred) : null
  const scoped = portfolio.data && scopePortfolio(portfolio.data, watched)
  const kpiAssets = watched ? scoped?.assets : assets.data
  const primary = (kpiAssets ?? []).filter((a) => a.kind === 'primary').length
  const competitors = (kpiAssets?.length ?? 0) - primary
  const counts = scoped ? homeCounts(scoped.events, todayIso()) : null
  const fresh = scoped ? newSince(scoped.events, since) : { events: [], assets: 0 }
  const showingNew = showNew && fresh.events.length > 0
  const running = runningJobs.data ?? []
  const onboarding = running.find((j) => j.type === 'onboard')
  const rival = all.find((a) => a.kind === 'competitor' && a.competitorOf.length > 0)

  const kpis: Kpi[] = [
    {
      label: 'Tracked assets',
      icon: Pill,
      value: kpiAssets ? primary : '—',
      hint: kpiAssets ? `${watched ? 'On your watchlist · ' : ''}${competitors} competitor${competitors === 1 ? '' : 's'} monitored` : undefined,
    },
    { label: 'New events', icon: Route, value: counts ? counts.new90 : '—', hint: watched ? 'Last 90 days, on your watchlist' : 'Last 90 days, across all assets' },
    { label: 'Upcoming milestones', icon: CalendarDays, value: counts ? counts.next12m : '—', hint: 'Next 12 months' },
  ]

  return (
    <HomeScopeContext.Provider value={{ watched, since, showNew: showingNew }}>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[20px] px-[24px] pt-[20px] pb-[48px] max-[900px]:px-[14px] max-[900px]:pt-[16px] max-[900px]:pb-[40px]">
        <HomeHero firstName={firstName} counts={counts} loading={portfolio.isPending} building={onboarding ? { name: onboarding.assetName ?? onboarding.asset, pct: pct(onboarding) } : null} />
        <div className="-mb-[6px] flex flex-wrap items-center gap-[10px]">
          {since && fresh.events.length > 0 && (
            <SinceBanner
              count={fresh.events.length}
              assets={fresh.assets}
              since={formatVisit(since, now)}
              showing={showingNew}
              onShow={() => {
                setShowNew(!showingNew)
                if (!showingNew) requestAnimationFrame(() => document.getElementById(WHAT_CHANGED_ID)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }))
              }}
            />
          )}
          <WatchlistChip count={starred.length} on={!!watched} onChange={setWatchOnly} className="ml-auto" />
        </div>
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
    </HomeScopeContext.Provider>
  )
}
