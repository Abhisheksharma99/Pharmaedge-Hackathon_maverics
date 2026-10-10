import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, use, useEffect, type ReactNode } from 'react'
import { ApiError, apiFetch, setUnauthorizedHandler } from '@/lib/api'

export type Role = 'admin' | 'analyst'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  active: boolean
  createdAt: string
}

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
}

export const ME_KEY = ['auth', 'me'] as const

const AuthContext = createContext<AuthContextValue | null>(null)

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

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
