import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Role, User } from '@/features/auth/auth-context'

const USERS_KEY = ['users'] as const

export interface NewUser {
  name: string
  email: string
  password: string
  role: Role
}

export function useUsers() {
  return useQuery({ queryKey: USERS_KEY, queryFn: () => apiFetch<User[]>('/users') })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewUser) => apiFetch<User>('/users', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...changes }: { id: string; role?: Role; active?: boolean }) =>
      apiFetch<User>(`/users/${id}`, { method: 'PATCH', body: changes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  })
}
