import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

/** An in-app notification (GET /notifications); `link` is an app path. */
export interface AppNotification {
  id: string
  /** onboarding_started | onboarding_finished | job_failed | high_event | comment (more may follow). */
  kind: string
  title: string
  sub: string
  link: string
  read: boolean
  at: string
}

export interface NotificationList {
  items: AppNotification[]
  unread: number
}

export interface Prefs {
  journeyView: 'h' | 'v'
  sidebarCollapsed: boolean
  notify: { highEvents: boolean; crawls: boolean; weeklyDigest: boolean }
  // Added later: an API build without them omits them.
  /** Starred asset ids. */
  watchlist?: string[]
  /** Home's Watchlist chip is on. */
  homeWatchlistOnly?: boolean
  /** Home visits (ISO): the latest and the previous one, which "Since your last visit" compares against. */
  lastSeen?: { home: string | null; homePrev: string | null }
}

export type PrefsPatch = Partial<Pick<Prefs, 'journeyView' | 'sidebarCollapsed' | 'watchlist' | 'homeWatchlistOnly'>> & {
  notify?: Partial<Prefs['notify']>
  /** "Home was opened at": the server keeps the previous visit (opens within 30 minutes count as one visit). */
  lastSeen?: { home: string }
}

const NOTIFICATIONS_KEY = ['notifications'] as const
const PREFS_KEY = ['me', 'prefs'] as const

/** The signed-in user's 30 newest notifications and unread count; refreshed every minute. */
export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiFetch<NotificationList>('/notifications'),
    refetchInterval: 60_000,
  })
}

/** Mark `ids` read, or every notification without `ids`; the cached list follows the server's unread count. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    // An empty `ids` list means nothing to mark; the API would read it as "mark all", so send nothing.
    mutationFn: async ({ ids }: { ids?: string[] }) =>
      ids?.length === 0 ? null : apiFetch<{ unread: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: (res, { ids }) =>
      res &&
      qc.setQueryData<NotificationList>(NOTIFICATIONS_KEY, (old) =>
        old && { unread: res.unread, items: old.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) },
      ),
  })
}

/** Per-user preferences (journey orientation, sidebar, notification toggles). */
export function usePrefs() {
  return useQuery({ queryKey: PREFS_KEY, queryFn: () => apiFetch<Prefs>('/me/prefs'), staleTime: Infinity })
}

/** PATCH a partial update; the full prefs it returns replace the cache. */
export function useSavePrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: PrefsPatch) => apiFetch<Prefs>('/me/prefs', { method: 'PATCH', body: patch }),
    onSuccess: (prefs) => qc.setQueryData(PREFS_KEY, prefs),
  })
}

/**
 * PATCH a partial update with the cache changed at once (stars, chips): the full prefs the server returns then
 * replace it, or a failure reloads the stored prefs.
 */
function useOptimisticPrefs() {
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (patch: PrefsPatch) => apiFetch<Prefs>('/me/prefs', { method: 'PATCH', body: patch }),
    onSuccess: (next) => qc.setQueryData(PREFS_KEY, next),
    onError: () => void qc.invalidateQueries({ queryKey: PREFS_KEY }),
  })
  return (patch: Pick<PrefsPatch, 'watchlist' | 'homeWatchlistOnly'>) => {
    qc.setQueryData<Prefs>(PREFS_KEY, (old) => old && { ...old, ...patch })
    save.mutate(patch)
  }
}

/** The starred asset ids and a toggle; the whole list is sent, built from the cache so quick toggles add up. */
export function useWatchlist() {
  const qc = useQueryClient()
  const ids = usePrefs().data?.watchlist ?? []
  const save = useOptimisticPrefs()
  const toggle = (id: string) => {
    const current = qc.getQueryData<Prefs>(PREFS_KEY)?.watchlist ?? []
    save({ watchlist: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] })
  }
  return { ids, toggle }
}

/** Home's Watchlist chip (on/off), remembered per user. */
export function useHomeWatchlistOnly() {
  const on = usePrefs().data?.homeWatchlistOnly ?? false
  const save = useOptimisticPrefs()
  return [on, (next: boolean) => save({ homeWatchlistOnly: next })] as const
}
