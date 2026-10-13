import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { ApiError, apiFetch, setUnauthorizedHandler } from '@/lib/api'
import { AuthContext, ME_KEY, type AuthContextValue, type User } from './use-auth'

export type { Role, User } from './use-auth'

/** Loads the signed-in user (via the httpOnly session cookie) and exposes login/logout. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await apiFetch<{ user: User }>('/auth/me')).user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    // A restart or deploy (502/503, network) is not a signed-out user: retry for ~30 s before giving up.
    retry: (failures, err) => !(err instanceof ApiError && err.status < 500) && failures < 6,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    staleTime: 5 * 60_000,
  })

  // A session that can't be refreshed signs the user out everywhere.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
      queryClient.setQueryData(ME_KEY, null)
    })
  }, [queryClient])

  const loginMutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiFetch<{ user: User }>('/auth/login', { method: 'POST', body: input }),
    onSuccess: ({ user }) => queryClient.setQueryData(ME_KEY, user),
  })

  const logoutMutation = useMutation({
    mutationFn: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(ME_KEY, null)
    },
  })

  const value: AuthContextValue = {
    user: me.data ?? null,
    isLoading: me.isPending,
    login: async (email, password) => (await loginMutation.mutateAsync({ email, password })).user,
    logout: async () => {
      await logoutMutation.mutateAsync().catch(() => undefined)
    },
  }
  return <AuthContext value={value}>{children}</AuthContext>
}
