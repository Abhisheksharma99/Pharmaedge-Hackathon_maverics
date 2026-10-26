import { createContext, useContext } from 'react'
import { usePortfolioTimeline } from './api'
import { isNewSince, scopePortfolio } from './home-data'
import type { PortfolioEvent } from './api'

/** What the Home page applies to every card: the Watchlist chip and "Since your last visit". */
export interface HomeScope {
  /** Watched asset ids while the Watchlist chip is on, else null (everything). */
  watched: ReadonlySet<string> | null
  /** The previous Home visit (ISO): events stored after it are "new". */
  since: string | null
  /** The banner's "Show": What changed lists only the new events. */
  showNew: boolean
}

export const HomeScopeContext = createContext<HomeScope>({ watched: null, since: null, showNew: false })

export const useHomeScope = () => useContext(HomeScopeContext)

/** A Home card's portfolio: the shared query, its data limited to the watchlist, and the "new since last visit" test. */
export function useHomePortfolio(opts?: { live?: boolean }) {
  const portfolio = usePortfolioTimeline(opts)
  const scope = useHomeScope()
  const data = portfolio.data && scopePortfolio(portfolio.data, scope.watched)
  return { portfolio, data, scope, isNew: (e: PortfolioEvent) => isNewSince(e, scope.since) }
}
