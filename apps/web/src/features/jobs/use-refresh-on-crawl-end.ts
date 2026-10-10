import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useJobs } from './api'

/** The server bumps its cache version a moment after the job status flips, so refetch once more after this. */
const SETTLE_MS = 3000

/**
 * Mounted once in AppLayout: when a running job leaves the running list, refresh everything a crawl writes
 * (portfolio, assets, the asset, notifications) now and again after the server's cache has settled.
 */
export function useRefreshOnCrawlEnd() {
  const qc = useQueryClient()
  const running = useJobs({ status: 'running' })
  const seen = useRef(new Map<string, string>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    if (!running.data) return
    const now = new Map(running.data.map((j) => [j.id, j.asset]))
    const assets = [...seen.current].filter(([id]) => !now.has(id)).map(([, asset]) => asset)
    seen.current = now
    if (!assets.length) return
    const refresh = () => {
      for (const key of [['portfolio'], ['assets'], ['notifications']]) qc.invalidateQueries({ queryKey: key })
      // Event queries too: the event sheet reads neighbours and branch stats, which a rebuild changes.
      for (const a of assets) qc.invalidateQueries({ queryKey: ['asset', a] })
    }
    refresh()
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      refresh()
    }, SETTLE_MS)
    timers.current.add(timer)
  }, [running.data, qc])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
}
