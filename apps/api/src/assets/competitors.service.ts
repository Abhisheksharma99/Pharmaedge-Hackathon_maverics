import { Inject, Injectable } from '@nestjs/common';
import type { Db, Document } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { AssetsService, type AssetDoc, type Coverage } from './assets.service.js';
import { SOURCE_TABS } from './source-registry.js';

const ACTIVE_TRIAL_STATUSES = ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION'];
const EVENT_FIELDS = { _id: 1, asset: 1, date: 1, title: 1, type: 1, category: 1, significance: 1, indication: 1, phase: 1, sources: 1 };

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const isoMonthsAhead = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

export interface Tally {
  total: number;
  recent: number;
}

/**
 * Everything the Competitors tab shows in one payload (spec §4.2): the
 * reference asset and its ranked competitors (identified by the crawl
 * service), their indication coverage, evidence volumes, latest moves and
 * upcoming milestones.
 */
@Injectable()
export class CompetitorsService {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
  ) {}

  async competitors(id: string) {
    const ref = await this.assets.getAsset(id);
    const ranked = ref.competitors ?? [];
    const ids = ranked.map((c) => c.id);
    return this.assets.cached(id, 'competitors', {}, () => this.load(ref, ids), ids);
  }

  private async load(ref: AssetDoc, ids: string[]) {
    const ranked = ref.competitors ?? [];
    const all = [ref._id, ...ids];
    const today = new Date().toISOString().slice(0, 10);
    const docs = new Map(
      (await this.db.collection<AssetDoc>('assets').find({ _id: { $in: ids } }).toArray()).map((d) => [d._id, d]),
    );
    const [approvals, trials, publications, regulatory, news, signals, milestones, upcomingMilestones] = await Promise.all([
      this.firstApprovals(all),
      this.trialStats(all),
      this.tally('publication_records', all, {}),
      this.tally(['fda_records', 'ema_records'], all, SOURCE_TABS.regulatory!.match ?? {}),
      this.tally(['articles', 'conference_records', 'company_records'], all, {
        $or: [{ record_type: { $exists: false } }, { record_type: { $in: ['press_release', 'conference_abstract'] } }],
      }),
      this.db
        .collection('journey_events')
        .find(
          // History only: a stopped trial is dated at its planned completion, which can lie in the future.
          { asset: { $in: ids }, is_milestone: false, significance: { $in: ['High', 'Medium'] }, date: { $gte: isoDaysAgo(730), $lte: today } },
          { projection: EVENT_FIELDS },
        )
        .sort({ date: -1 })
        .limit(12)
        .toArray(),
      this.db
        .collection('journey_events')
        .find({ asset: { $in: ids }, is_milestone: true, date: { $gte: today, $lte: isoMonthsAhead(24) } }, { projection: EVENT_FIELDS })
        .sort({ date: 1 })
        .limit(60)
        .toArray(),
      this.db.collection('journey_events').countDocuments({ asset: { $in: ids }, is_milestone: true, date: { $gte: today, $lte: isoMonthsAhead(24) } }),
    ]);

    const indications = [...(ref.tags.indications ?? []), ...(ref.tags.investigational_indications ?? [])];
    const referenceCoverage: Record<string, Coverage> = Object.fromEntries(
      indications.map((i) => [i, (ref.tags.indications ?? []).includes(i) ? 'approved' : 'investigational']),
    );
    const row = (assetId: string) => ({
      firstApproval: approvals.get(assetId)?.first ?? null,
      approvalRegions: approvals.get(assetId)?.regions ?? [],
      activeTrials: trials.get(assetId)?.active ?? 0,
      activePhase3: trials.get(assetId)?.activePhase3 ?? 0,
    });
    const nameOf = (assetId: string) => (assetId === ref._id ? ref.name : (docs.get(assetId)?.name ?? ranked.find((c) => c.id === assetId)?.name ?? assetId));
    const companyOf = (assetId: string) => docs.get(assetId)?.company?.name ?? ranked.find((c) => c.id === assetId)?.company ?? '';
    const event = (e: Document) => {
      const { _id, asset, ...rest } = e;
      return { id: _id, assetId: asset, assetName: nameOf(asset), company: companyOf(asset), ...rest };
    };

    return {
      reference: { id: ref._id, name: ref.name, company: ref.company.name, mechanism: ref.tags.mechanism ?? null, indications },
      kpis: {
        tracked: ranked.length,
        candidates: ref.competitor_scan?.candidates ?? 0,
        collecting: ids.filter((c) => (docs.get(c)?.status ?? 'onboarding') === 'onboarding').length,
        activePhase3: ids.reduce((n, c) => n + (trials.get(c)?.activePhase3 ?? 0), 0),
        upcomingMilestones,
        firstMilestone: (milestones[0]?.date as string | undefined) ?? null,
      },
      landscape: [
        {
          id: ref._id,
          name: ref.name,
          company: ref.company.name,
          mechanism: ref.tags.mechanism ?? null,
          modality: ref.tags.modality ?? null,
          status: ref.status,
          isReference: true,
          coverage: referenceCoverage,
          otherIndications: [],
          overlap: { shared: indications.length, of: indications.length },
          ...row(ref._id),
        },
        ...ranked.map((c) => {
          const doc = docs.get(c.id);
          return {
            id: c.id,
            name: doc?.name ?? c.name,
            company: doc?.company?.name ?? c.company ?? '',
            mechanism: doc?.tags?.mechanism ?? null,
            modality: doc?.tags?.modality ?? null,
            status: doc?.status ?? 'onboarding',
            isReference: false,
            reason: c.reason,
            basis: c.basis,
            stage: c.stage,
            coverage: Object.fromEntries(indications.map((i) => [i, c.coverage?.[i] ?? 'none'])),
            otherIndications: c.other_indications ?? [],
            overlap: { shared: indications.filter((i) => (c.coverage?.[i] ?? 'none') !== 'none').length, of: indications.length },
            ...row(c.id),
          };
        }),
      ],
      evidence: all.map((assetId) => ({
        id: assetId,
        name: nameOf(assetId),
        trials: { total: trials.get(assetId)?.total ?? 0, recent: trials.get(assetId)?.recent ?? 0 },
        publications: publications.get(assetId) ?? { total: 0, recent: 0 },
        regulatory: regulatory.get(assetId) ?? { total: 0, recent: 0 },
        news: news.get(assetId) ?? { total: 0, recent: 0 },
      })),
      signals: signals.map(event),
      milestones: milestones.map(event),
    };
  }

  /** First FDA / EMA authorisation per asset (rule events only: AI-extracted approvals carry free-text regions). */
  private async firstApprovals(ids: string[]) {
    const rows = await this.db
      .collection('journey_events')
      .aggregate<{ _id: string; first: string; regions: string[] }>([
        { $match: { asset: { $in: ids }, origin: 'rule', type: 'approval', date: { $ne: '' } } },
        { $group: { _id: '$asset', first: { $min: '$date' }, regions: { $addToSet: '$region' } } },
      ])
      .toArray();
    return new Map(rows.map((r) => [r._id, { first: r.first, regions: r.regions.filter(Boolean).sort() }]));
  }

  private async trialStats(ids: string[]) {
    const cutoff = isoDaysAgo(365);
    const rows = await this.db
      .collection('trial_records')
      .aggregate<{ _id: string; total: number; recent: number; active: number; activePhase3: number }>([
        { $match: { assets: { $in: ids } } },
        { $project: { assets: 1, date: 1, overall_status: 1, phases: 1 } },
        { $unwind: '$assets' },
        { $match: { assets: { $in: ids } } },
        {
          $group: {
            _id: '$assets',
            total: { $sum: 1 },
            recent: { $sum: { $cond: [{ $gte: ['$date', cutoff] }, 1, 0] } },
            active: { $sum: { $cond: [{ $in: ['$overall_status', ACTIVE_TRIAL_STATUSES] }, 1, 0] } },
            activePhase3: {
              $sum: {
                $cond: [{ $and: [{ $in: ['$overall_status', ACTIVE_TRIAL_STATUSES] }, { $in: ['PHASE3', { $ifNull: ['$phases', []] }] }] }, 1, 0],
              },
            },
          },
        },
      ])
      .toArray();
    return new Map(rows.map(({ _id, ...r }) => [_id, r]));
  }

  /** Records per asset across collections: total and dated within the last year. */
  private async tally(collections: string | string[], ids: string[], match: Document): Promise<Map<string, Tally>> {
    const cutoff = isoDaysAgo(365);
    const out = new Map<string, Tally>();
    for (const coll of [collections].flat()) {
      const rows = await this.db
        .collection(coll)
        .aggregate<{ _id: string; total: number; recent: number }>([
          { $match: { assets: { $in: ids }, ...match } },
          { $project: { assets: 1, date: 1 } },
          { $unwind: '$assets' },
          { $match: { assets: { $in: ids } } },
          { $group: { _id: '$assets', total: { $sum: 1 }, recent: { $sum: { $cond: [{ $gte: ['$date', cutoff] }, 1, 0] } } } },
        ])
        .toArray();
      for (const r of rows) {
        const cur = out.get(r._id) ?? { total: 0, recent: 0 };
        out.set(r._id, { total: cur.total + r.total, recent: cur.recent + r.recent });
      }
    }
    return out;
  }
}
