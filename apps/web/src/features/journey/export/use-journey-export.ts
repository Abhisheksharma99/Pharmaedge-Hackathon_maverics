import { useMemo } from 'react'
import { useAnnotations } from '../annotations-api'
import { useJourneyEvents } from '../api'
import { chronological, filterJourney, type ListFilters } from '../journey-model'
import { useJourneyFilters } from '../use-journey-filters'
import type { JourneyEventV3 } from '../types'
import type { ExportContext } from './model'

/** What an Export menu holds; the click adds the export time and origin. */
export type ExportDraft = Omit<ExportContext, 'exportedAt' | 'origin'>

const NO_STARS: string[] = []

/** The export of a journey as shown: the URL's scope, filters and order, and the shown events (already in that order). */
export function journeyExportDraft(
  asset: ExportContext['asset'],
  f: Pick<ExportContext, 'scope' | 'order'> & Required<Pick<ListFilters, 'cats' | 'mine' | 'ind' | 'q'>>,
  events: JourneyEventV3[],
): ExportDraft {
  return { asset, scope: f.scope, order: f.order, filters: { cats: f.cats, mine: f.mine, ind: f.ind, q: f.q }, events }
}

/**
 * The journey's export where the journey itself may not be on screen (the asset header, the Asset Journey page
 * header): the same queries and URL filters as `JourneySection`, so both menus export the same events.
 * `disabled` until the events (and, for Starred, the stars) are in.
 */
export function useJourneyExport(asset: ExportContext['asset']): { ctx: ExportDraft; disabled: boolean } {
  const f = useJourneyFilters()
  const events = useJourneyEvents(asset.id, f.scope)
  const annotations = useAnnotations(asset.id)
  const all = events.data?.events
  const stars = f.mine === 'starred' ? (annotations.data?.stars ?? NO_STARS) : NO_STARS
  const catsKey = f.cats.join(',')
  const shown = useMemo(() => {
    const list = filterJourney(chronological(all ?? []), { cats: catsKey ? (catsKey.split(',') as typeof f.cats) : [], mine: f.mine, ind: f.ind, q: f.q }, stars)
    return f.order === 'newest' ? list.reverse() : list
  }, [all, catsKey, f.mine, f.ind, f.q, f.order, stars])
  const ready = events.isSuccess && !events.isPlaceholderData && (f.mine !== 'starred' || annotations.isSuccess)
  return { ctx: journeyExportDraft(asset, f, shown), disabled: !ready }
}
