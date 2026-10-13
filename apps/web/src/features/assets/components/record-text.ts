import { safeUrl } from '@/lib/utils'
import type { SourceRecord } from '../api'

/** A record's display title: its title, else the EMA medicine name, the FDA brand + submission, the application number, its key. */
export function recordTitle(r: SourceRecord): string {
  const brands = Array.isArray(r.brand_names) ? (r.brand_names as string[]).join(' / ') : ''
  return (
    (r.title as string) ||
    (r.name_of_medicine as string) ||
    (brands && `${brands} · ${r.submission_type ?? ''}${r.submission_number ?? ''}`) ||
    (r.application_number as string) ||
    r.key
  )
}

/** The record's page at its source (most records carry `url`; EMA medicines and safety letters their own link). */
export function recordUrl(r: SourceRecord): string | undefined {
  return safeUrl(r.url) ?? safeUrl(r.medicine_url) ?? safeUrl(r.dhpc_url)
}
