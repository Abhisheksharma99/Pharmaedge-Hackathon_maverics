import type { TableExportResult } from '@/components/table-export-menu'
import type { CardFilterSelect } from '@/components/card-filters'
import { CATEGORY_META } from '@/features/journey/constants'
import { eventLink, isoDate } from '@/features/journey/export/model'
import { eventIndications } from '@/features/journey/indications'
import type { JourneyEventV3 } from '@/features/journey/types'
import type { PortfolioAsset } from './api'

/** "Search “tyvaso” · Indication: PAH · Asset: Treprostinil", or "None": a card's applied filters. */
export function cardFiltersText({ query, selects }: { query: string; selects: Pick<CardFilterSelect, 'label' | 'value'>[] }): string {
  const parts = [query.trim() && `Search “${query.trim()}”`, ...selects.filter((s) => s.value).map((s) => `${s.label}: ${s.value}`)].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'None'
}

/**
 * A Home card's events as an export: date, title, asset (tracked or competitor), category, significance,
 * indications and a link that opens the event on the Asset Journey page.
 */
export function portfolioEventsExport({
  card,
  stem,
  events,
  assets,
  filters,
  origin,
}: {
  card: string
  stem: string
  events: JourneyEventV3[]
  assets: Map<string, PortfolioAsset>
  filters: string
  origin: string
}): TableExportResult {
  const n = events.length
  return {
    stem,
    done: `Exported ${n} event${n === 1 ? '' : 's'}`,
    table: {
      sheet: card,
      columns: [
        { header: 'Date', kind: 'date' },
        { header: 'Title' },
        { header: 'Asset' },
        { header: 'Tracked as' },
        { header: 'Category' },
        { header: 'Significance' },
        { header: 'Indications' },
        { header: 'Event link', kind: 'link' },
      ],
      rows: events.map((e) => {
        const asset = assets.get(e.asset)
        return [
          isoDate(e.date),
          e.title,
          asset?.name ?? e.asset,
          asset?.kind === 'competitor' ? 'Competitor' : 'Asset',
          CATEGORY_META[e.category]?.label ?? e.category,
          e.significance ?? '',
          eventIndications(e).join('; '),
          eventLink({ asset: { id: e.asset, name: '' }, origin }, e),
        ]
      }),
      about: [
        ['Card', `Home · ${card}`],
        ['Filters', filters],
        ['Events', n],
      ],
    },
  }
}
