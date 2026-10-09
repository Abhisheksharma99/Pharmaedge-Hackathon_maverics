import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Db, Document } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { toEventV3 } from '../journey/events.js';
import { CacheService } from '../valkey/cache.service.js';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EVENT_FIELDS = { asset: 1, date: 1, title: 1, type: 1, category: 1, significance: 1, is_milestone: 1, branch: 1, origin: 1, key: 1, sources: 1, nct_id: 1 };

/** Home portfolio timeline and ⌘K search across every tracked asset (DATA_CONTRACTS §B.1, §B.5). */
@Injectable()
export class PortfolioService {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly cache: CacheService,
  ) {}

  async timeline(q: { from?: string; to?: string; competitors?: boolean }) {
    const version = await this.cache.version('assets:ver');
    const key = `portfolio:v${version}:${createHash('sha1').update(JSON.stringify(q)).digest('hex').slice(0, 16)}`;
    const hit = await this.cache.getJson<unknown>(key);
    if (hit) return hit;
    const assets = await this.db.collection('assets').find(q.competitors ? {} : { kind: 'primary' }, { projection: { name: 1, kind: 1, status: 1, company: 1, competitor_of: 1 } }).sort({ kind: -1, name: 1 }).toArray();
    const ids = assets.map((a) => a._id);
    const running = await this.db.collection('jobs').find({ asset: { $in: ids }, status: { $in: ['queued', 'running'] } }, { projection: { asset: 1, steps: 1 } }).toArray();
    const progress = new Map(running.map((j) => [j.asset, (j.steps ?? []).length ? (j.steps as Document[]).filter((s) => s.status === 'done').length / j.steps.length : 0]));
    const match: Document = { asset: { $in: ids }, key: true };
    if (q.from || q.to) match.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
    const events = await this.db.collection('journey_events').find(match, { projection: EVENT_FIELDS }).sort({ date: 1 }).limit(2000).toArray();
    const out = {
      assets: assets.map((a) => ({ id: a._id, name: a.name, kind: a.kind, company: a.company?.name ?? null, status: a.status, progress: progress.get(a._id) ?? null, competitorOf: a.competitor_of ?? [] })),
      events: events.map(toEventV3),
    };
    await this.cache.setJson(key, out, 60);
    return out;
  }

  async search(q: string) {
    const re = new RegExp(escapeRegex(q.trim()), 'i');
    const assets = await this.db
      .collection('assets')
      .find({ $or: [{ name: re }, { aliases: re }, { 'company.name': re }, { 'tags.indications': re }, { 'tags.mechanism': re }] }, { projection: { name: 1, kind: 1, company: 1, competitor_of: 1 } })
      .sort({ kind: -1, name: 1 })
      .limit(6)
      .toArray();
    const events =
      q.trim().length < 2
        ? []
        : await this.db.collection('journey_events').find({ $or: [{ title: re }, { nct_id: re }] }, { projection: { asset: 1, title: 1, date: 1, category: 1, nct_id: 1, key: 1 } }).sort({ key: -1, date: -1 }).limit(6).toArray();
    const names = new Map((await this.db.collection('assets').find({ _id: { $in: [...new Set(events.map((e) => e.asset))] } }, { projection: { name: 1 } }).toArray()).map((a) => [a._id, a.name as string]));
    return {
      assets: assets.map((a) => ({ id: a._id, name: a.name, kind: a.kind, company: a.company?.name ?? null, competitorOf: a.competitor_of ?? [] })),
      events: events.map((e) => ({ id: e._id, asset: e.asset, assetName: names.get(e.asset) ?? e.asset, title: e.title, date: e.date, category: e.category, nct_id: e.nct_id ?? null })),
    };
  }
}
