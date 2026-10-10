import { useState } from 'react'

const PREFIX = 'aj.collapsed.'

/**
 * A hide/show choice remembered per `key` in localStorage (filter bars, the Asset Journey list). Storage may be
 * missing or blocked (private mode), in which case the choice lasts for the page's life only.
 */
export function useCollapsed(key: string, initial = false) {
  const [collapsed, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(PREFIX + key)
      return saved === null ? initial : saved === '1'
    } catch {
      return initial
    }
  })
  const setCollapsed = (next: boolean) => {
    setState(next)
    try {
      localStorage.setItem(PREFIX + key, next ? '1' : '0')
    } catch {
      // not persisted
    }
  }
  return [collapsed, setCollapsed] as const
}
