import type { SourceRecord } from '../api'
import { shortIndication } from './competitors/utils'

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/**
 * The indications a source record names, short form. Only fields that really are indications: a trial's conditions,
 * an EMA medicine's therapeutic area, an orphan designation's intended use ("Treatment of X" → "X").
 * Records without such a field (publications, conference abstracts, FDA submissions, documents) return [].
 */
export function recordIndications(r: SourceRecord): string[] {
  const found = [
    ...strs(r.conditions),
    ...(typeof r.therapeutic_area_mesh === 'string' ? [r.therapeutic_area_mesh] : []),
    ...(typeof r.intended_use === 'string' ? [r.intended_use.replace(/^(treatment|prevention) of\s+/i, '')] : []),
  ]
    .map((x) => shortIndication(x.trim()))
    .filter(Boolean)
  return [...new Set(found)]
}
