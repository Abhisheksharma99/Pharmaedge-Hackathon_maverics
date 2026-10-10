import { Inject, Injectable } from '@nestjs/common';
import type { Db, Document } from 'mongodb';
import type { Bar } from '../chat/market.js';
import { MONGO_DB } from '../database/database.module.js';
import { AssetsService } from './assets.service.js';
import { composeStory, type Story, type StorySpec } from './story.js';

const EVENT_FIELDS = {
  title: 1, date: 1, type: 1, category: 1, summary: 1, significance: 1, is_milestone: 1, origin: 1, region: 1,
  indication: 1, phase: 1, verification: 1, sponsor: 1, sponsor_is_company: 1, sources: { $slice: 3 }, merged_sources: 1,
};

/**
 * Loads what a journey story needs from the stored data and composes it (story.ts). Read-only; cached per asset
 * version (and the compared asset's), which the crawl worker bumps when a job ends.
 */
@Injectable()
export class StoryService {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
  ) {}

  story(assetId: string, spec: StorySpec): Promise<Story> {
    // The view name carries the response version: a cached entry of an older shape is never served after a deploy.
    return this.assets.cached(assetId, 'story:v2', spec, async () => {
      const asset = await this.assets.getAsset(assetId);
      const today = new Date().toISOString().slice(0, 10);
      const otherId = spec.compare && spec.compare !== assetId ? spec.compare : null;
      const [events, changes, slides, ledger, market, other] = await Promise.all([
        this.db.collection('journey_events').find({ asset: assetId }, { projection: EVENT_FIELDS }).toArray(),
        this.db.collection('journey_changes').find({ asset: assetId }).sort({ at: -1 }).limit(2000).toArray(),
        this.db
          .collection('company_records')
          .find(
            { assets: assetId, record_type: 'presentation_slide', 'metrics.validation.status': 'conflict', ...(spec.since ? { date: { $gte: spec.since } } : {}) },
            { projection: { record_key: 1, title: 1, slide_title: 1, date: 1, metrics: 1 } },
          )
          .limit(50)
          .toArray(),
        spec.since
          ? this.db
              .collection('crawl_ledger')
              .find({ asset: assetId, decided_at: { $gte: new Date(`${spec.since}T00:00:00Z`) } }, { projection: { title: 1, date: 1, source: 1, category: 1, decision: 1, url: 1 } })
              .limit(5000)
              .toArray()
          : Promise.resolve([]),
        this.market(assetId),
        otherId ? this.other(otherId) : Promise.resolve(null),
      ]);
      return composeStory({ asset, events, changes, slides, ledger, market, other, spec, today });
    }, spec.compare ? [spec.compare] : []);
  }

  private async market(assetId: string) {
    const listings = await this.db.collection('market_listings').find({ asset: assetId, stale: { $ne: true } }).toArray();
    const listing = listings.find((l) => (l.roles as string[] | undefined)?.includes('asset_company')) ?? listings[0];
    if (!listing) return null;
    const prices = await this.db.collection('market_prices').findOne({ _id: listing.ticker });
    const bars = ((prices?.bars ?? []) as Bar[]).filter((b) => typeof b.close === 'number' && typeof b.date === 'string');
    return bars.length ? { listing, bars, source: (prices?.source as string | undefined) ?? null } : null;
  }

  private async other(id: string): Promise<{ asset: Document; events: Document[] } | null> {
    const asset = await this.db.collection('assets').findOne({ _id: id as never });
    if (!asset) return null;
    const events = await this.db.collection('journey_events').find({ asset: id }, { projection: EVENT_FIELDS }).toArray();
    return { asset, events };
  }
}
