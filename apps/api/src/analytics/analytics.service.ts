import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Db, Document } from 'mongodb';
import { AssetsService } from '../assets/assets.service.js';
import { SOURCE_TABS } from '../assets/source-registry.js';
import { MONGO_DB } from '../database/database.module.js';
import { suggest } from './analytics.suggest.js';
import { activityByYear, landscape, patentRows, pipeline, significanceMix, stats, trialRows } from './analytics.blocks.js';

const RECORD_COLLECTIONS = ['fda_records', 'ema_records', 'trial_records', 'publication_records', 'conference_records', 'patent_records', 'company_records', 'articles'];
/** Insight facets of list fields: the tables show the first value, so the charts count that one. */
const FIRST_VALUE = new Set(['phases', 'conditions', 'publication_types', 'assignees']);
const YEAR = { $substrBytes: [{ $ifNull: [{ $toString: '$date' }, ''] }, 0, 4] };
const today = () => new Date().toISOString().slice(0, 10);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Analytics tab blocks, records-tab insights and per-user pins (DATA_CONTRACTS §B.4). */
@Injectable()
export class AnalyticsService implements OnModuleInit {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
  ) {}

  async onModuleInit() {
    await this.db.collection('analytics_pins').createIndex({ asset: 1, user: 1 }, { unique: true });
    await this.db.collection('asset_analytics').createIndex({ asset: 1 }, { unique: true });
  }

  async blocks(id: string) {
    const asset = await this.assets.getAsset(id);
    const competitors = asset.competitors ?? [];
    return this.assets.cached(id, 'analytics', {}, async () => {
      const t = today();
      const [branches, events, trials, patents, perColl, ledger] = await Promise.all([
        this.db.collection('asset_branches').find({ asset: id }).toArray(),
        this.db.collection('journey_events').find({ asset: id }, { projection: { branch: 1, type: 1, category: 1, region: 1, date: 1, significance: 1, is_milestone: 1, phase: 1, title: 1, origin: 1, key: 1 } }).toArray(),
        this.db.collection('trial_records').find({ assets: id }, { projection: { study: 0 } }).toArray(),
        this.db.collection('patent_records').find({ assets: id, country: 'US', kind: /^B/ }, { projection: { abstract: 0, events: 0, cpc: 0, inventors: 0 } }).toArray(),
        Promise.all(RECORD_COLLECTIONS.map(async (coll) => ({ coll, rows: await this.db.collection(coll).aggregate([{ $match: { assets: id } }, { $group: { _id: YEAR, n: { $sum: 1 } } }]).toArray() }))),
        this.db.collection('crawl_ledger').aggregate([{ $match: { asset: id } }, { $group: { _id: '$decision', n: { $sum: 1 } } }]).toArray(),
      ]);
      branches.sort((a, b) => Number(!!b.trunk) - Number(!!a.trunk) || String(a.start ?? '').localeCompare(String(b.start ?? '')));
      const pipe = pipeline(branches, events, asset, t);
      const trialList = trialRows(trials, asset.company?.name);
      const patentList = patentRows(patents, t);
      const decisions = Object.fromEntries(ledger.map((r) => [r._id as string, r.n as number]));
      const sourceMix = perColl.map(({ coll, rows }) => ({ coll, n: rows.reduce((s, r) => s + (r.n as number), 0) })).filter((r) => r.n > 0);
      const evidenceRecords = sourceMix.reduce((s, r) => s + r.n, 0);
      const out = {
        pipeline: pipe,
        activityByYear: activityByYear(events),
        trials: trialList,
        recordsByYear: perColl.flatMap(({ coll, rows }) => rows.filter((r) => /^\d{4}$/.test(String(r._id))).map((r) => ({ coll, year: Number(r._id), n: r.n as number }))),
        sourceMix,
        triageFunnel: {
          screened: Object.values(decisions).reduce((s, n) => s + n, 0),
          relevant: (decisions.ingest ?? 0) + (decisions.headline ?? 0),
          ingested: decisions.ingest ?? 0,
          candidates: events.filter((e) => e.origin === 'ai').length,
          journey: events.filter((e) => e.origin === 'ai' && e.key).length,
        },
        patents: patentList,
        landscape: landscape(asset, competitors),
        significance: significanceMix(events),
        stats: stats({ pipeline: pipe, trials: trialList, events, evidenceRecords }, t),
      };
      await this.db.collection('asset_analytics').updateOne({ asset: id }, { $set: { computed_at: new Date(), blocks: out } }, { upsert: true });
      return out;
    }, competitors.map((c) => c.id));
  }

  async suggestions(id: string) {
    const asset = await this.assets.getAsset(id);
    const competitors = asset.competitors ?? [];
    return this.assets.cached(id, 'analytics:suggestions', { day: today() }, async () => {
      const ids = competitors.map((c) => c.id);
      const [branches, events, trials, milestones, sec] = await Promise.all([
        this.db.collection('asset_branches').find({ asset: id }).toArray(),
        this.db.collection('journey_events').find({ asset: id }, { projection: { branch: 1, type: 1, product: 1, is_milestone: 1, indications: 1, sources: 1 } }).toArray(),
        this.db.collection('trial_records').find({ assets: id }, { projection: { record_key: 1, start_date: 1, phases: 1, conditions: 1 } }).toArray(),
        ids.length ? this.db.collection('journey_events').find({ asset: { $in: ids }, is_milestone: true, date: { $gte: today() } }, { projection: { asset: 1, sources: 1 } }).toArray() : [],
        asset.company?.cik || asset.company?.ticker ? true : this.db.collection('company_records').countDocuments({ assets: id, url: /sec\.gov/i }).then((n) => n > 0),
      ]);
      const names = new Map(competitors.map((c) => [c.id, c.name]));
      return suggest({ asset, branches, events, trials, competitorMilestones: milestones.map((m) => ({ ...m, assetName: names.get(m.asset as string) })), secFiler: !!sec });
    }, competitors.map((c) => c.id));
  }

  async insights(id: string, tabName: string) {
    if (tabName === 'evidence') return this.evidenceInsights(id);
    if (!Object.hasOwn(SOURCE_TABS, tabName)) throw new NotFoundException({ code: 'TAB_NOT_FOUND', message: `No tab "${tabName}"` });
    const tab = SOURCE_TABS[tabName]!;
    const asset = await this.assets.getAsset(id);
    return this.assets.cached(id, `insights:${tabName}`, {}, async () => {
      const match: Document = { assets: id, ...tab.match };
      const company = escapeRegex(asset.company?.name ?? '');
      const group =
        tabName === 'clinical'
          ? company
            ? { $cond: [{ $regexMatch: { input: { $ifNull: ['$lead_sponsor', ''] }, regex: company, options: 'i' } }, 'company', 'other'] }
            : 'other'
          : tabName === 'regulatory'
            ? { $cond: [{ $regexMatch: { input: { $ifNull: ['$record_type', ''] }, regex: '^fda' } }, 'US', 'EU'] }
            : tabName === 'conferences'
              ? '$conference'
              : tabName === 'company-ir'
                ? { $let: { vars: { t: { $ifNull: [{ $arrayElemAt: [{ $ifNull: ['$tags', []] }, 0] }, ''] } }, in: { $cond: [{ $eq: ['$$t', ''] }, 'Other', '$$t'] } } }
                : null;
      const facets: Document = {
        total: [{ $count: 'n' }],
        byYear: [{ $group: { _id: YEAR, n: { $sum: 1 } } }],
        ...(group && { byYearGroup: [{ $group: { _id: { year: YEAR, group }, n: { $sum: 1 } } }] }),
      };
      if (tabName === 'regulatory') {
        // FDA records carry brand names, EMA records the medicine name.
        const product = { $ifNull: ['$name_of_medicine', { $arrayElemAt: [{ $ifNull: ['$brand_names', []] }, 0] }] };
        facets.product = [{ $group: { _id: product, n: { $sum: 1 } } }, { $match: { _id: { $nin: [null, ''] } } }, { $sort: { n: -1 } }, { $limit: 12 }];
      }
      if (tabName === 'documents') {
        const pages = { $ifNull: ['$page_count', '$pages'] };
        facets.top = [{ $addFields: { __pages: pages } }, { $match: { $expr: { $isNumber: '$__pages' } } }, { $sort: { __pages: -1 } }, { $limit: 6 }, { $project: { _id: 0, title: 1, pages: '$__pages' } }];
      }
      if (tabName === 'patents') {
        facets.terms = [
          { $match: { expiry_date: { $type: 'string', $ne: '' } } },
          // Newest expiries first so a cap never drops the longest-running patents; the chart sorts them back.
          { $sort: { expiry_date: -1 } },
          { $limit: 40 },
          { $project: { _id: 0, number: '$publication_number', title: 1, granted: '$grant_date', expiry: '$expiry_date', status: '$legal_status', assignee: { $arrayElemAt: [{ $ifNull: ['$assignees', []] }, 0] } } },
        ];
      }
      for (const f of tab.insightFacets) {
        // Fields the table shows by their first value count that value only, so the charts add up to the row count.
        const value = FIRST_VALUE.has(f) ? { $arrayElemAt: [{ $ifNull: [`$${f}`, []] }, 0] } : null;
        facets[f] = [
          ...(value ? [{ $addFields: { __v: value } }, { $match: { __v: { $nin: [null, ''] } } }, { $group: { _id: '$__v', n: { $sum: 1 } } }] : [{ $unwind: { path: `$${f}`, preserveNullAndEmptyArrays: false } }, { $group: { _id: `$${f}`, n: { $sum: 1 } } }]),
          { $sort: { n: -1 } },
          { $limit: 12 },
        ];
      }
      const [first, ...others] = tab.collections;
      const [r] = await this.db
        .collection(first!)
        .aggregate([{ $match: match }, ...others.map((coll) => ({ $unionWith: { coll, pipeline: [{ $match: match }] } })), { $facet: facets }])
        .toArray();
      const years = (rows: Document[] = []) => rows.filter((x) => /^\d{4}$/.test(String(x._id))).map((x) => ({ year: Number(x._id), n: x.n as number }));
      return {
        tab: tabName,
        total: r?.total[0]?.n ?? 0,
        byYear: years(r?.byYear),
        byYearGroup: ((r?.byYearGroup ?? []) as Document[]).filter((x) => /^\d{4}$/.test(String(x._id.year)) && typeof x._id.group === 'string' && x._id.group !== '').map((x) => ({ year: Number(x._id.year), group: x._id.group as string, n: x.n as number })),
        facets: Object.fromEntries(
          [...tab.insightFacets, ...(tabName === 'regulatory' ? ['product'] : [])].map((f) => [f, ((r?.[f] ?? []) as Document[]).filter((x) => x._id !== null && x._id !== '').map((x) => ({ value: String(x._id), n: x.n as number }))]),
        ),
        ...(tabName === 'documents' && { top: ((r?.top ?? []) as Document[]).map((x) => ({ title: String(x.title ?? ''), pages: x.pages as number })) }),
        ...(tabName === 'patents' && { terms: r?.terms ?? [] }),
      };
    });
  }

  /** Evidence tab: AI triage funnel, decisions and top sources, all from the crawl ledger. */
  private async evidenceInsights(id: string) {
    await this.assets.getAsset(id);
    return this.assets.cached(id, 'insights:evidence', {}, async () => {
      const [decisions, sources, journey] = await Promise.all([
        this.db.collection('crawl_ledger').aggregate([{ $match: { asset: id } }, { $group: { _id: '$decision', n: { $sum: 1 } } }]).toArray(),
        this.db.collection('crawl_ledger').aggregate([{ $match: { asset: id, source: { $nin: [null, ''] } } }, { $group: { _id: '$source', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 5 }]).toArray(),
        this.db.collection('journey_events').countDocuments({ asset: id, origin: 'ai', key: true }),
      ]);
      const n = Object.fromEntries(decisions.map((d) => [d._id as string, d.n as number]));
      const total = decisions.reduce((s, d) => s + (d.n as number), 0);
      return {
        tab: 'evidence',
        total,
        byYear: [],
        byYearGroup: [],
        facets: {
          decision: ['ingest', 'headline', 'skip'].filter((d) => n[d]).map((d) => ({ value: d, n: n[d]! })),
          source: sources.map((x) => ({ value: String(x._id), n: x.n as number })),
        },
        triage: { screened: total, relevant: (n.ingest ?? 0) + (n.headline ?? 0), ingested: n.ingest ?? 0, journey },
      };
    });
  }

  async pins(id: string, user: string) {
    await this.assets.getAsset(id);
    const doc = await this.db.collection('analytics_pins').findOne({ asset: id, user });
    return { items: (doc?.items as unknown[]) ?? null };
  }

  async savePins(id: string, user: string, items: unknown) {
    await this.assets.getAsset(id);
    const valid = Array.isArray(items) && items.length <= 24 && items.every((p) => isPin(p));
    if (!valid) throw new BadRequestException({ code: 'INVALID_PINS', message: 'Pins must be up to 24 items, each a template key or a custom analysis with sources.' });
    await this.db.collection('analytics_pins').updateOne({ asset: id, user }, { $set: { items, updated_at: new Date() } }, { upsert: true });
    return { items };
  }
}

/** A pin is a template key, or a custom spec that carries its sources (never numbers without sources). */
function isPin(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false;
  const { key, custom } = p as { key?: unknown; custom?: Record<string, unknown> };
  if (typeof key === 'string') return key.length > 0 && key.length <= 40 && custom === undefined;
  if (!custom || typeof custom !== 'object') return false;
  const sources = custom.sources;
  return (
    typeof custom.id === 'string' &&
    typeof custom.title === 'string' &&
    ['index', 'web', 'none'].includes(custom.method as string) &&
    Array.isArray(sources) &&
    (sources.length > 0 || custom.method === 'none')
  );
}
