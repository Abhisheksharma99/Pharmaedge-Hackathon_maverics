import type { AnalyticsSpec } from '@/features/journey/types'

export type Row = { l: string; v: number; c?: string }
export const rows = (d: unknown) => (Array.isArray(d) ? (d as Row[]) : [])

/** Whether a spec can be drawn: only then (with sources) may it be shown or pinned. */
export function isRenderable(spec: AnalyticsSpec): boolean {
  const d = rows(spec.data)
  switch (spec.chart) {
    case 'hbar':
    case 'bars':
    case 'donut':
    case 'list':
      return d.length > 0
    case 'stack':
      return !!spec.cols && !!spec.series?.length
    default:
      return false
  }
}
