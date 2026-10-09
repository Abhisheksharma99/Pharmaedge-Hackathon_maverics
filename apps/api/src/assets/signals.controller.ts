import { Controller, Get, Inject } from '@nestjs/common';
import type { Db, Document } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { AssetsService, type AssetDoc } from './assets.service.js';

const FIELDS = { asset: 1, date: 1, title: 1, type: 1, category: 1, significance: 1, sources: 1 };

/** Home page feed: the latest high-significance moves and the next milestones across every tracked asset. */
@Controller('signals')
export class SignalsController {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
  ) {}

  @Get()
  signals() {
    return this.assets.cached(null, 'signals', {}, async () => {
      const today = new Date().toISOString().slice(0, 10);
      const events = this.db.collection('journey_events');
      const [recent, upcoming, assets] = await Promise.all([
        events.find({ is_milestone: false, significance: 'High', date: { $lte: today, $ne: '' } }, { projection: FIELDS }).sort({ date: -1 }).limit(12).toArray(),
        events.find({ is_milestone: true, significance: { $in: ['High', 'Medium'] }, date: { $gte: today } }, { projection: FIELDS }).sort({ date: 1 }).limit(12).toArray(),
        this.db.collection<AssetDoc>('assets').find({}, { projection: { name: 1, kind: 1 } }).toArray(),
      ]);
      const byId = new Map(assets.map((a) => [a._id, a]));
      const view = ({ _id, asset, ...e }: Document) => ({ id: _id, assetId: asset, assetName: byId.get(asset)?.name ?? asset, kind: byId.get(asset)?.kind ?? null, ...e });
      return { recent: recent.map(view), upcoming: upcoming.map(view) };
    });
  }
}
