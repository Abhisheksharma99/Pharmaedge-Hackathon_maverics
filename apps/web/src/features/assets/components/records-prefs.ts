import { use, useState } from 'react'
import { AuthContext } from '@/features/auth/use-auth'

const PREFIX = 'aj.records.'

export type Density = 'comfortable' | 'compact'

function read<T>(key: string, valid: (v: unknown) => v is T, fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    if (saved === null) return fallback
    const v: unknown = JSON.parse(saved)
    return valid(v) ? v : fallback
  } catch {
    return fallback
  }
}

/**
 * A records-table choice remembered per signed-in user in localStorage (like `useCollapsed`). Storage may be missing or
 * blocked (private mode), in which case the choice lasts for the page's life only.
 */
function useUserPref<T>(name: string, valid: (v: unknown) => v is T, fallback: T) {
  const user = use(AuthContext)?.user?.id ?? 'anonymous'
  const key = `${PREFIX}${user}.${name}`
  const [state, setState] = useState(() => ({ key, value: read(key, valid, fallback) }))
  // Another user (or tab) → their choice (adjusted while rendering, so the old one never shows).
  if (state.key !== key) setState({ key, value: read(key, valid, fallback) })
  const set = (value: T) => {
    setState({ key, value })
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // not persisted
    }
  }
  return [state.key === key ? state.value : read(key, valid, fallback), set] as const
}

const isHeaders = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isDensity = (v: unknown): v is Density => v === 'comfortable' || v === 'compact'

/** The column headers hidden on one records tab. */
export const useHiddenColumns = (tab: string) => useUserPref<string[]>(`columns.${tab}`, isHeaders, [])

/** Row density of every records table. */
export const useDensity = () => useUserPref<Density>('density', isDensity, 'comfortable')
