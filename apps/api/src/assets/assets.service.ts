import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Db, Document } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { CacheService } from '../valkey/cache.service.js';
import type { RecordsQueryDto, TimelineQueryDto } from './dto/asset-queries.dto.js';
import { noteToEvent, toEventV3, type NoteDoc } from '../journey/events.js';
import { SOURCE_TABS, listOmit, type SourceTab } from './source-registry.js';

const CACHE_TTL_SECONDS = 3600;
const ACTIVE_TRIAL_STATUSES = ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION'];

export type Coverage = 'approved' | 'investigational' | 'none';

/** A ranked competitor of a primary asset, as written by the crawl service's `competitors` step. */
export interface CompetitorRef {
  id: string;
  name: string;
  company?: string;
  reason: string;
  basis: 'indication' | 'mechanism' | 'both';
  stage: 'approved' | 'phase3' | 'phase2' | 'other';
  /** One entry per reference indication (the primary's approved + investigational indications). */
  coverage: Record<string, Coverage>;
  other_indications: string[];
}

export interface AssetDoc {
  _id: string;
  name: string;
  aliases: string[];
  company: { name: string; website?: string; ir_url?: string; cik?: string; ticker?: string };
  tags: { indications?: string[]; investigational_indications?: string[]; mechanism?: string; modality?: string; routes?: string[] };
  ids?: { adis?: string };
  kind: 'primary' | 'competitor';
  status: 'onboarding' | 'ready' | 'failed';
  competitors?: CompetitorRef[];
  competitor_scan?: { at: Date; candidates: number };
  competitor_of?: string[];
  suggested_questions?: string[];
  created_by?: { id: string; name: string };
  updated_at?: Date;
}

/** Asset ids are slugs of the canonical name (spec §3.2); same rule as the crawler's journey/store.asset_id. */
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hash = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const facetField = (key: string) => `__f_${key}`;

export interface EventRef {
  id: string;
  title: string;
  date: string;
  category: string;
  significance?: string;
}

/** The facet selections of a records request: only the tab's own facets, string values only; bad JSON is a 400. */
function parseFacetSelection(tab: SourceTab, raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException({ code: 'INVALID_FACETS', message: 'facets must be a JSON object' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestException({ code: 'INVALID_FACETS', message: 'facets must be a JSON object' });
  }
  const known = new Set((tab.facets ?? []).map((f) => f.key));
  return Object.fromEntries(Object.entries(parsed).filter(([k, v]) => known.has(k) && typeof v === 'string' && v !== ''));
}

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class AssetsService {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly cache: CacheService,
  ) {}

  /**
   * Read-through cache keyed by the data version of the asset (bumped by the crawl worker). A view that also shows
   * other assets (competitors) passes their ids too, so a crawl of any of them invalidates it.
   */
  async cached<T>(assetId: string | null, name: string, params: unknown, load: () => Promise<T>, alsoIds: string[] = []): Promise<T> {
    const versionKey = assetId ? `asset:${assetId}:ver` : 'assets:ver';
    const versions = await Promise.all([versionKey, ...alsoIds.map((a) => `asset:${a}:ver`)].map((k) => this.cache.version(k)));
    const key = `${assetId ? `asset:${assetId}` : 'assets'}:v${versions.join('-')}:${name}:${hash([params, alsoIds])}`;
    const hit = await this.cache.getJson<T>(key);
    if (hit !== null) return hit;
    const value = await load();
    await this.cache.setJson(key, value, CACHE_TTL_SECONDS);
    return value;
  }

  async getAsset(id: string): Promise<AssetDoc> {
    const asset = await this.db.collection<AssetDoc>('assets').findOne({ _id: id });
    if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: `No asset "${id}"` });
    return asset;
  }

  private tab(name: string): SourceTab {
    if (!Object.hasOwn(SOURCE_TABS, name)) throw new NotFoundException({ code: 'TAB_NOT_FOUND', message: `No tab "${name}"` });
    return SOURCE_TABS[name]!;
  }

  private async counts(id: string) {
    const q = { assets: id };
    const [trials, regulatory, pressReleases, documents, news, publications, conferences, patents, events] = await Promise.all([
      this.db.collection('trial_records').countDocuments(q),
      Promise.all(['fda_records', 'ema_records'].map((c) =>
        this.db.collection(c).countDocuments({ ...q, ...SOURCE_TABS.regulatory.match }),
      )).then(([a, b]) => a + b),
      this.db.collection('company_records').countDocuments({ ...q, ...SOURCE_TABS['company-ir'].match }),
      this.db.collection('company_records').countDocuments({ ...q, ...SOURCE_TABS.documents.match }),
      this.db.collection('articles').countDocuments(q),
      this.db.collection('publication_records').countDocuments(q),
      this.db.collection('conference_records').countDocuments(q),
      this.db.collection('patent_records').countDocuments(q),
      this.db.collection('journey_events').countDocuments({ asset: id }),
    ]);
    return { trials, regulatory, pressReleases, documents, news, publications, conferences, patents, events };
  }

  private async summary(asset: AssetDoc) {
    const [latestEvent, primaries] = await Promise.all([
      this.db
        .collection('journey_events')
        .find({ asset: asset._id, is_milestone: false, significance: 'High' }, { projection: { _id: 0, date: 1, title: 1, type: 1 } })
        .sort({ date: -1 })
        .limit(1)
        .next(),
      asset.competitor_of?.length
        ? this.db.collection<AssetDoc>('assets').find({ _id: { $in: asset.competitor_of } }, { projection: { name: 1 } }).toArray()
        : [],
    ]);
    return {
      id: asset._id,
      name: asset.name,
      aliases: asset.aliases ?? [],
      company: asset.company,
      tags: asset.tags ?? {},
      kind: asset.kind,
      status: asset.status,
      updatedAt: asset.updated_at ?? null,
      counts: await this.counts(asset._id),
      latestEvent,
      competitorOf: primaries.map((p) => ({ id: p._id, name: p.name })),
    };
  }

  list() {
    return this.cached(null, 'list', {}, async () => {
      const assets = await this.db.collection<AssetDoc>('assets').find().sort({ name: 1 }).toArray();
      return Promise.all(assets.map((a) => this.summary(a)));
    });
  }

  detail(id: string) {
    return this.cached(id, 'detail', {}, async () => {
      const asset = await this.getAsset(id);
      const events = this.db.collection('journey_events');
      const trials = this.db.collection('trial_records');
      const [approvalRegions, activeTrials, activePhase3, upcomingMilestones] = await Promise.all([
        // FDA / EMA authorisations only: AI-extracted approvals carry free-text regions.
        events.distinct('region', { asset: id, type: 'approval', origin: 'rule' }),
        trials.countDocuments({ assets: id, overall_status: { $in: ACTIVE_TRIAL_STATUSES } }),
        trials.countDocuments({ assets: id, overall_status: { $in: ACTIVE_TRIAL_STATUSES }, phases: 'PHASE3' }),
        events.countDocuments({ asset: id, is_milestone: true, date: { $gte: today() } }),
      ]);
      return {
        ...(await this.summary(asset)),
        kpis: { approvalRegions, activeTrials, activePhase3, upcomingMilestones },
        competitors: asset.competitors ?? [],
        suggestedQuestions: asset.suggested_questions ?? [],
      };
    });
  }

  async timeline(id: string, query: TimelineQueryDto) {
    const { include, ...cacheable } = query;
    const base = await this.cached(id, 'timeline:v3', cacheable, async () => {
      await this.getAsset(id);
      const match: Document = { asset: id };
      if (query.category?.length) match.category = { $in: query.category };
      if (query.significance?.length) match.significance = { $in: query.significance };
      if (query.milestones === 'only') match.is_milestone = true;
      if (query.milestones === 'exclude') match.is_milestone = false;
      if (query.from || query.to) match.date = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
      if (query.companyOnly) match.$or = [{ category: { $ne: 'clinical' } }, { sponsor_is_company: true }];
      if (query.scope === 'key') match.key = true;
      if (query.branch?.length) match.branch = { $in: query.branch };
      const sort = query.milestones === 'only' ? { date: 1 as const } : { date: -1 as const };
      const coll = this.db.collection('journey_events');
      const [events, total] = await Promise.all([coll.find(match).sort(sort).limit(query.limit).toArray(), coll.countDocuments(match)]);
      return { events: events.map(toEventV3), total };
    });
    if (!include?.includes('notes')) return base;
    // Notes change often and per team: merged outside the cache.
    // Resolved "Missed by AI" notes are skipped: the event the crawler made carries their content.
    const noteMatch: Document = { asset: id, resolved_event: { $exists: false } };
    if (query.category?.length) noteMatch.category = { $in: query.category };
    if (query.branch?.length) noteMatch.branch = { $in: query.branch };
    if (query.from || query.to) noteMatch.date = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
    const notes = (await this.db.collection<NoteDoc>('journey_notes').find(noteMatch).toArray()).map((n) => noteToEvent(n));
    const asc = query.milestones === 'only';
    const events = [...base.events, ...notes].sort((a, b) => (asc ? 1 : -1) * String(a.date).localeCompare(String(b.date)));
    return { events, total: base.total + notes.length };
  }

  records(id: string, tabName: string, query: RecordsQueryDto) {
    const tab = this.tab(tabName);
    const selected = parseFacetSelection(tab, query.facets);
    return this.cached(id, `records:${tabName}`, query, async () => {
      const asset = await this.getAsset(id);
      const base: Document = { assets: id, ...tab.match };
      const match: Document = { ...base };
      if (query.q) {
        const re = new RegExp(escapeRegex(query.q), 'i');
        match.$or = tab.searchFields.map((f) => ({ [f]: re }));
      }
      if (query.type?.length) match.record_type = { $in: query.type };
      if (query.phase?.length) match.phases = { $in: query.phase };
      if (query.status?.length) match[tab.statusField ?? 'overall_status'] = { $in: query.status };
      if (query.mentionsOnly) match.mentions = { $exists: true, $ne: [] };
      if (query.companyOnly && tab.sponsorField && asset.company?.name) {
        match[tab.sponsorField] = new RegExp(escapeRegex(asset.company.name), 'i');
      }

      const [first, ...others] = tab.collections;
      const union = (m: Document) => others.map((coll) => ({ $unionWith: { coll, pipeline: [{ $match: m }] } }));
      const defs = tab.facets ?? [];
      const derive = defs.length ? [{ $addFields: Object.fromEntries(defs.map((f) => [facetField(f.key), f.expr])) }] : [];
      const picked = Object.entries(selected).map(([k, v]) => ({ [facetField(k)]: v }));
      const omit = { ...listOmit(tab), ...Object.fromEntries(defs.map((f) => [facetField(f.key), 0 as const])) };
      const coll = this.db.collection(first!);

      const [[result], [counts]] = await Promise.all([
        coll
          .aggregate([
            { $match: match },
            ...union(match),
            ...derive,
            ...(picked.length ? [{ $match: { $and: picked } }] : []),
            { $sort: { date: -1, [tab.keyField]: 1 } },
            {
              $facet: {
                items: [
                  { $skip: (query.page - 1) * query.pageSize },
                  { $limit: query.pageSize },
                  { $addFields: { key: `$${tab.keyField}` } },
                  { $project: omit },
                ],
                total: [{ $count: 'n' }],
              },
            },
          ])
          .toArray(),
        // The panel's distribution bar and selects count the whole tab, whatever is searched or selected.
        coll
          .aggregate([
            { $match: base },
            ...union(base),
            ...derive,
            {
              $facet: {
                all: [{ $count: 'n' }],
                ...Object.fromEntries(
                  defs.map((f) => [
                    f.key,
                    [
                      { $unwind: `$${facetField(f.key)}` },
                      { $match: { [facetField(f.key)]: { $nin: [null, ''] } } },
                      { $group: { _id: `$${facetField(f.key)}`, count: { $sum: 1 } } },
                      { $sort: { count: -1, _id: 1 } },
                      { $limit: 50 },
                    ],
                  ]),
                ),
              },
            },
          ])
          .toArray(),
      ]);
      const items = await this.withEvents(id, result?.items ?? []);
      return {
        items,
        total: result?.total[0]?.n ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        all: counts?.all[0]?.n ?? 0,
        facets: defs.map((f) => ({
          key: f.key,
          label: f.label,
          values: ((counts?.[f.key] ?? []) as { _id: string; count: number }[]).map((v) => ({ value: String(v._id), count: v.count })),
        })),
      };
    });
  }

  /** Adds `journey_events` (not `events`: patents carry their own legal events): the journey events built from each record (as a source or folded in by AI consolidation). */
  async withEvents<T extends Document>(id: string, records: T[]): Promise<(T & { journey_events: EventRef[] })[]> {
    const keys = records.map((r) => r.key as string).filter(Boolean);
    const docs = keys.length
      ? await this.db
          .collection('journey_events')
          .find(
            { asset: id, $or: [{ 'sources.record_key': { $in: keys } }, { 'merged_sources.record_key': { $in: keys } }] },
            { projection: { title: 1, date: 1, category: 1, significance: 1, sources: 1, merged_sources: 1 } },
          )
          .sort({ date: 1 })
          .toArray()
      : [];
    const byKey = new Map<string, EventRef[]>();
    for (const e of docs) {
      const ref: EventRef = { id: e._id as unknown as string, title: e.title, date: e.date, category: e.category, significance: e.significance };
      for (const k of new Set([...(e.sources ?? []), ...(e.merged_sources ?? [])].map((r: { record_key: string }) => r.record_key))) {
        byKey.set(k, [...(byKey.get(k) ?? []), ref]);
      }
    }
    return records.map((r) => ({ ...r, journey_events: byKey.get(r.key as string) ?? [] }));
  }

  async record(id: string, tabName: string, key: string) {
    const tab = this.tab(tabName);
    await this.getAsset(id);
    for (const coll of tab.collections) {
      const doc = await this.db
        .collection(coll)
        .findOne({ assets: id, ...tab.match, [tab.keyField]: key }, { projection: { _id: 0 } });
      if (doc) {
        const [withEvents] = await this.withEvents(id, [{ ...doc, key: doc[tab.keyField] }]);
        return withEvents;
      }
    }
    throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Record not found' });
  }

  /** FAERS adverse-event reports per month (a volume signal, not a safety verdict). */
  adverseEvents(id: string) {
    return this.cached(id, 'series:adverse-events', {}, async () => {
      await this.getAsset(id);
      const rows = await this.db
        .collection('fda_records')
        .find({ assets: id, record_type: 'fda_adverse_events_monthly' }, { projection: { _id: 0, month: 1, report_count: 1 } })
        .sort({ month: 1 })
        .toArray();
      return rows.map((r) => ({ month: r.month as string, count: r.report_count as number }));
    });
  }
}
