import { useEffect, useState } from 'react'

/** Wall-clock time, re-read every second while `ticking` (elapsed clocks, "updated 8 s ago"). */
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}
