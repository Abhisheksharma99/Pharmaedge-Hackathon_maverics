import type { SourceRecord } from '../api'
import { shortIndication } from './competitors/utils'

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/**
 * The indications a source record belongs to, short form. Tabs the API derives them for (every record tab but
 * clinical) send `indications`: the journey events citing the record, else the known indications its text names.
 * Otherwise only fields that really are indications: a trial's conditions, an EMA medicine's therapeutic area, an
 * orphan designation's intended use ("Treatment of X" → "X").
 */
export function recordIndications(r: SourceRecord): string[] {
  if (Array.isArray(r.indications)) return [...new Set(strs(r.indications).map((x) => shortIndication(x.trim())).filter(Boolean))]
  const found = [
    ...strs(r.conditions),
    ...(typeof r.therapeutic_area_mesh === 'string' ? [r.therapeutic_area_mesh] : []),
    ...(typeof r.intended_use === 'string' ? [r.intended_use.replace(/^(treatment|prevention) of\s+/i, '')] : []),
  ]
    .map((x) => shortIndication(x.trim()))
    .filter(Boolean)
  return [...new Set(found)]
}
