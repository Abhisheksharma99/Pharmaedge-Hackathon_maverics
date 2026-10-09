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
}

export type PrefsPatch = Partial<Pick<Prefs, 'journeyView' | 'sidebarCollapsed'>> & { notify?: Partial<Prefs['notify']> }

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
