import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Db, Document } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { CacheService } from '../valkey/cache.service.js';
import type { RecordsQueryDto, TimelineQueryDto } from './dto/asset-queries.dto.js';
import { SOURCE_TABS, type SourceTab } from './source-registry.js';

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
  company: { name: string; website?: string; ir_url?: string };
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
    const tab = SOURCE_TABS[name];
    if (!tab) throw new NotFoundException({ code: 'TAB_NOT_FOUND', message: `No tab "${name}"` });
    return tab;
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

  timeline(id: string, query: TimelineQueryDto) {
    return this.cached(id, 'timeline', query, async () => {
      await this.getAsset(id);
      const match: Document = { asset: id };
      if (query.category?.length) match.category = { $in: query.category };
      if (query.significance?.length) match.significance = { $in: query.significance };
      if (query.milestones === 'only') match.is_milestone = true;
      if (query.milestones === 'exclude') match.is_milestone = false;
      if (query.from || query.to) match.date = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
      if (query.companyOnly) match.$or = [{ category: { $ne: 'clinical' } }, { sponsor_is_company: true }];
      const sort = query.milestones === 'only' ? { date: 1 as const } : { date: -1 as const };
      const coll = this.db.collection('journey_events');
      const [events, total] = await Promise.all([
        coll.find(match, { projection: { updated_at: 0 } }).sort(sort).limit(query.limit).toArray(),
        coll.countDocuments(match),
      ]);
      return { events: events.map(({ _id, ...e }) => ({ id: _id, ...e })), total };
    });
  }

  records(id: string, tabName: string, query: RecordsQueryDto) {
    const tab = this.tab(tabName);
    return this.cached(id, `records:${tabName}`, query, async () => {
      await this.getAsset(id);
      const match: Document = { assets: id, ...tab.match };
      if (query.q) {
        const re = new RegExp(escapeRegex(query.q), 'i');
        match.$or = tab.searchFields.map((f) => ({ [f]: re }));
      }
      if (query.type?.length) match.record_type = { $in: query.type };
      if (query.phase?.length) match.phases = { $in: query.phase };
      if (query.status?.length) match[tab.statusField ?? 'overall_status'] = { $in: query.status };
      if (query.mentionsOnly) match.mentions = { $exists: true, $ne: [] };

      const [first, ...others] = tab.collections;
      const omit = Object.fromEntries([...tab.omitInList, '_id'].map((f) => [f, 0]));
      const [result] = await this.db
        .collection(first!)
        .aggregate([
          { $match: match },
          ...others.map((coll) => ({ $unionWith: { coll, pipeline: [{ $match: match }] } })),
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
        .toArray();
      return {
        items: result?.items ?? [],
        total: result?.total[0]?.n ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async record(id: string, tabName: string, key: string) {
    const tab = this.tab(tabName);
    await this.getAsset(id);
    for (const coll of tab.collections) {
      const doc = await this.db
        .collection(coll)
        .findOne({ assets: id, ...tab.match, [tab.keyField]: key }, { projection: { _id: 0 } });
      if (doc) return { ...doc, key: doc[tab.keyField] };
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
