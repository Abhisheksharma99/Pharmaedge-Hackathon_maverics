import { shortIndication } from '@/features/assets/components/competitors/utils'

/** The fields an event (journey, portfolio, analytics row) can say its indication with. */
export interface IndicationSource {
  /** The journey's indication branch (PAH, PH-ILD, …), the canonical label. */
  branch?: string
  /** Extra branches the event also covers. */
  span?: string[]
  /** Enrichment's indications, often full names. */
  indications?: string[]
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))]

/**
 * The indications an event belongs to, short form: its branch (plus spanned branches) when it has one,
 * else its enrichment indications shortened ("Pulmonary arterial hypertension (PAH)" → "PAH").
 */
export function eventIndications(e: IndicationSource): string[] {
  if (e.branch) return uniq([e.branch, ...(e.span ?? [])])
  return uniq((e.indications ?? []).map(shortIndication))
}

/** Every indication across `items`, sorted, for an indication filter. */
export function indicationOptions<T>(items: T[], of: (item: T) => string[]): string[] {
  return uniq(items.flatMap(of)).sort((a, b) => a.localeCompare(b))
}
