import { Inject, Injectable } from '@nestjs/common';
import type { Db, Document } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { AssetsService } from './assets.service.js';
import type { LedgerQueryDto } from './dto/asset-queries.dto.js';
import { SOURCE_TABS } from './source-registry.js';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Evidence tab sources: label, collections and match (the same subsets the record tabs show). */
const SOURCES: { key: string; label: string; collections: string[]; match?: Document }[] = [
  { key: 'trials', label: 'Clinical trials', collections: ['trial_records'] },
  { key: 'regulatory', label: 'Regulatory records', collections: ['fda_records', 'ema_records'], match: SOURCE_TABS.regulatory!.match },
  { key: 'publications', label: 'Publications', collections: ['publication_records'] },
  { key: 'conferences', label: 'Conference abstracts', collections: ['conference_records'] },
  { key: 'pressReleases', label: 'Press releases', collections: ['company_records'], match: SOURCE_TABS['company-ir']!.match },
  { key: 'documents', label: 'Company documents', collections: ['company_records'], match: SOURCE_TABS.documents!.match },
  { key: 'news', label: 'News and wires', collections: ['articles'] },
  { key: 'patents', label: 'Patents', collections: ['patent_records'] },
];

/**
 * The evidence base behind an asset's journey: how much each source holds, and
 * every AI triage decision (crawl_ledger) with its reason — what was kept,
 * what was kept as a headline only, and what was dropped.
 */
@Injectable()
export class EvidenceService {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
  ) {}

  async evidence(id: string) {
    await this.assets.getAsset(id);
    return this.assets.cached(id, 'evidence', {}, async () => {
      const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const sources = await Promise.all(
        SOURCES.map(async ({ key, label, collections, match }) => {
          const counts = await Promise.all(
            collections.map((c) =>
              Promise.all([
                this.db.collection(c).countDocuments({ assets: id, ...match }),
                this.db.collection(c).countDocuments({ assets: id, ...match, date: { $gte: cutoff } }),
              ]),
            ),
          );
          return { key, label, total: counts.reduce((n, [t]) => n + t, 0), recent: counts.reduce((n, [, r]) => n + r, 0) };
        }),
      );
      const rows = await this.db
        .collection('crawl_ledger')
        .aggregate<{ _id: { decision: string; category: string }; n: number }>([
          { $match: { asset: id } },
          { $group: { _id: { decision: '$decision', category: '$category' }, n: { $sum: 1 } } },
        ])
        .toArray();
      const triage = { total: 0, ingest: 0, headline: 0, skip: 0 };
      const byCategory = new Map<string, { category: string; ingest: number; headline: number; skip: number }>();
      for (const { _id, n } of rows) {
        const decision = _id.decision as 'ingest' | 'headline' | 'skip';
        if (!(decision in triage)) continue;
        triage.total += n;
        triage[decision] += n;
        const cat = byCategory.get(_id.category) ?? { category: _id.category, ingest: 0, headline: 0, skip: 0 };
        cat[decision] += n;
        byCategory.set(_id.category, cat);
      }
      const total = (c: { ingest: number; headline: number; skip: number }) => c.ingest + c.headline + c.skip;
      return { sources, triage: { ...triage, byCategory: [...byCategory.values()].sort((a, b) => total(b) - total(a)) } };
    });
  }

  /** Triage decisions for the asset, newest items first. */
  async ledger(id: string, query: LedgerQueryDto) {
    await this.assets.getAsset(id);
    return this.assets.cached(id, 'ledger', query, async () => {
      const match: Document = { asset: id };
      if (query.decision) match.decision = query.decision;
      if (query.collection) match.collection = query.collection;
      if (query.category) match.category = query.category;
      if (query.q) match.title = new RegExp(escapeRegex(query.q), 'i');
      const coll = this.db.collection('crawl_ledger');
      const [rows, total] = await Promise.all([
        coll
          .find(match)
          .sort({ date: -1, decided_at: -1 })
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize)
          .toArray(),
        coll.countDocuments(match),
      ]);
      return {
        items: rows.map((r) => ({
          id: r._id,
          title: r.title ?? null,
          url: r.url ?? null,
          date: r.date ?? '',
          source: r.source ?? null,
          collection: r.collection ?? null,
          decision: r.decision,
          category: r.category,
          reason: r.reason,
          model: r.model,
          decidedAt: r.decided_at ?? null,
          recordKey: r.item_key,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
}
