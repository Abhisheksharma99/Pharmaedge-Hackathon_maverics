import { eventIndications } from '../indications'
import { eventLink, eventSources, isoDate, sourceUrl, type ExportContext } from './model'

/** The shown events with every field useful outside the app, pretty-printed. */
export function toJson(ctx: ExportContext): string {
  const { cats, mine, ind, q } = ctx.filters
  const doc = {
    asset: { id: ctx.asset.id, name: ctx.asset.name },
    exportedAt: ctx.exportedAt.toISOString(),
    scope: ctx.scope,
    filters: { categories: cats, mine: mine ?? null, indication: ind ?? null, title: q?.trim() || null },
    order: ctx.order,
    events: ctx.events.map((e) => ({
      id: e.id,
      date: isoDate(e.date),
      expected: e.is_milestone,
      title: e.title,
      category: e.category,
      type: e.type,
      significance: e.significance,
      indications: eventIndications(e),
      targets: e.indications ?? [],
      branch: e.branch ?? null,
      span: e.span ?? [],
      summary: e.summary ?? null,
      impact: e.impact ?? null,
      product: e.product ?? null,
      details: e.details ?? {},
      region: e.region ?? null,
      phase: e.phase ?? null,
      nct_id: e.nct_id ?? null,
      sponsor: e.sponsor ?? null,
      via: e.via,
      ...(e.user && { note: { tag: e.user.tag, by: e.user.by.name, created_at: e.user.created_at } }),
      sources: eventSources(e).map((s) => ({ collection: s.collection, record_key: s.record_key, ...(sourceUrl(s) && { url: sourceUrl(s) }) })),
      link: eventLink(ctx, e),
    })),
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}
