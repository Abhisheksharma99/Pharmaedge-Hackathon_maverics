import { useQuery } from '@tanstack/react-query'
import type { JobFeedItem, JobProgress } from '@/features/journey/types'
import { apiFetch } from '@/lib/api'
import { isActive, type Job } from './api'

/** GET /jobs/:id/feed?since=N: up to 500 lines after N, ascending id; the cursor never goes back. */
export interface FeedPage {
  items: JobFeedItem[]
  cursor: number
}

/** The live-build log so far, accumulated across polls (and remounts: it lives in the query cache). */
export interface FeedState {
  items: JobFeedItem[]
  cursor: number
  /** Lines the last fetch added. */
  fresh: number
  /** The last fetch started after the job had finished. */
  final: boolean
}

const FEED_PAGE_SIZE = 500
const FEED_MAX_PAGES = 20
export const EMPTY_FEED: FeedState = { items: [], cursor: 0, fresh: 0, final: false }

/** Adds a page to the log: one line per id (a repeated id replaces the line), in id order; the cursor only moves forward. */
export function mergeFeed(prev: FeedState, page: FeedPage): FeedState {
  const byId = new Map(prev.items.map((item) => [item.id, item]))
  const before = byId.size
  for (const item of page.items) byId.set(item.id, item)
  return {
    items: [...byId.values()].sort((a, b) => a.id - b.id),
    cursor: Math.max(prev.cursor, page.cursor, ...page.items.map((item) => item.id)),
    fresh: prev.fresh + byId.size - before,
    final: prev.final,
  }
}

/**
 * Feed polling: every 2 s while the job runs; once it has ended, until the job's last line is in. A fetch that started
 * after the end and found nothing new stops it (a line the crawler failed to write never arrives).
 */
export function feedPollInterval(
  job: (Pick<Job, 'status'> & Pick<JobProgress, 'feed_cursor'>) | undefined,
  feed: FeedState | undefined,
): number | false {
  if (!job) return false
  if (isActive(job.status)) return 2000
  if (!feed || feed.cursor >= job.feed_cursor) return false
  return !feed.final || feed.fresh > 0 ? 2000 : false
}

/**
 * The job's live-build log (DATA_CONTRACTS §B.2), polled by cursor. Each fetch resumes from the cursor in the cache,
 * so a remount continues where it stopped, and reads every waiting page (≤500 lines each). Idle while `job` is undefined.
 */
export function useJobFeed(job: Pick<JobProgress, 'id' | 'status' | 'feed_cursor'> | undefined) {
  const id = job?.id ?? null
  return useQuery({
    queryKey: ['job', id, 'feed'],
    queryFn: async ({ client, queryKey, signal }) => {
      const status = client.getQueryData<Job>(['job', id])?.status
      let state: FeedState = { ...(client.getQueryData<FeedState>(queryKey) ?? EMPTY_FEED), fresh: 0, final: !!status && !isActive(status) }
      for (let page = 0; page < FEED_MAX_PAGES; page++) {
        const next = await apiFetch<FeedPage>(`/jobs/${encodeURIComponent(id!)}/feed?since=${state.cursor}`, { signal })
        state = mergeFeed(state, next)
        if (next.items.length < FEED_PAGE_SIZE) break
      }
      return state
    },
    enabled: id !== null,
    refetchInterval: (q) => feedPollInterval(job, q.state.data),
  })
}
