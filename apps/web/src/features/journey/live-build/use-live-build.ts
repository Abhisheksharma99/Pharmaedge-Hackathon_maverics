import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import type { AssetDetail } from '@/features/assets/api'
import { isActive, useJobProgress, useJobs } from '@/features/jobs/api'
import { useJobFeed } from '@/features/jobs/feed'
import { useEventsById, useTimelineV3 } from '../api'
import type { JobFeedItem, JobProgress, JourneyEventV3 } from '../types'
import { lastEventLine, liveEventIds, uniqueEvents } from './build-model'

export interface LiveBuildData {
  /** loading: finding the job; error: it couldn't be loaded; none: the asset has never been crawled. */
  state: 'loading' | 'error' | 'none' | 'ready'
  job: JobProgress | undefined
  feed: JobFeedItem[]
  /** On the forming timeline: the key journey plus every event the feed announced, once each. */
  events: JourneyEventV3[]
  /** Events the feed announced, newest first. */
  latest: JourneyEventV3[]
}

const NO_LINES: JobFeedItem[] = []
/** The crawler bumps the API's cache version just after it marks the job finished: reload once more after this. */
const REFRESH_AGAIN_MS = 3000

/**
 * Everything the live build shows for an asset's newest crawl job: the job (polled 2 s while active), its feed (by
 * cursor), and the events. The API serves the timeline from a cache that only moves when the job ends, so events the
 * feed announces are loaded one by one (uncached route); the timeline is refetched only when the feed announces an
 * event, and the asset, timeline and asset list are reloaded when the job ends — also when that happened while the tab
 * was hidden, or before this view mounted for an asset still marked onboarding.
 */
export function useLiveBuild(asset: Pick<AssetDetail, 'id' | 'status'>): LiveBuildData {
  const qc = useQueryClient()
  const jobs = useJobs({ asset: asset.id })
  const progress = useJobProgress(jobs.data?.[0]?.id ?? null)
  const job = progress.data
  const feed = useJobFeed(job)
  const timeline = useTimelineV3(asset.id, { scope: 'key' })
  const items = feed.data?.items ?? NO_LINES
  const ids = useMemo(() => liveEventIds(items), [items])
  const announced = useEventsById(asset.id, ids)

  const jobId = job?.id
  const lastEvent = feed.data ? lastEventLine(feed.data.items) : null
  const seenEvent = useRef<number | null>(null)
  const seenFor = useRef(jobId)
  useEffect(() => {
    if (seenFor.current !== jobId) {
      seenFor.current = jobId
      seenEvent.current = null
    }
    if (lastEvent === null) return
    if (seenEvent.current !== null && lastEvent > seenEvent.current) {
      void qc.invalidateQueries({ queryKey: ['asset', asset.id, 'timeline-v3'] })
    }
    seenEvent.current = lastEvent
  }, [lastEvent, jobId, asset.id, qc])

  // The end-of-job reload (and its 3 s repeat) must not depend on the asset status: the first reload flips it to ready.
  const status = useRef(asset.status)
  useEffect(() => {
    status.current = asset.status
  }, [asset.status])
  const finished = job ? !isActive(job.status) : null
  const wasActive = useRef(false)
  const reloadedFor = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (finished === null) return
    if (!finished) {
      wasActive.current = true
      return
    }
    if (reloadedFor.current === jobId) return
    if (!wasActive.current && status.current !== 'onboarding') return
    reloadedFor.current = jobId ?? null
    wasActive.current = false
    const reload = () => {
      void qc.invalidateQueries({ queryKey: ['asset', asset.id], exact: true })
      void qc.invalidateQueries({ queryKey: ['asset', asset.id, 'timeline-v3'] })
      void qc.invalidateQueries({ queryKey: ['assets'] })
    }
    reload()
    timer.current = setTimeout(reload, REFRESH_AGAIN_MS)
  }, [finished, jobId, asset.id, qc])
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      reloadedFor.current = null
    },
    [jobId, asset.id],
  )

  const events = useMemo(() => uniqueEvents(timeline.data?.events ?? [], announced), [timeline.data, announced])
  const latest = useMemo(() => [...announced].reverse(), [announced])
  const state =
    (jobs.isError && !jobs.data) || (progress.isError && !job)
      ? 'error'
      : jobs.data && jobs.data.length === 0
        ? 'none'
        : job
          ? 'ready'
          : 'loading'
  return { state, job, feed: items, events, latest }
}
