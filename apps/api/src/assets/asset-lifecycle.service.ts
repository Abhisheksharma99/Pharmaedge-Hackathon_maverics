import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Db } from 'mongodb';
import type { AuthUser } from '../auth/auth.types.js';
import { addMessage, findSession } from '../chat/chat.store.js';
import { MONGO_DB } from '../database/database.module.js';
import { CrawlerClient } from '../jobs/crawler.client.js';
import { CacheService } from '../valkey/cache.service.js';
import { AssetsService, slug, type AssetDoc } from './assets.service.js';
import type { CreateAssetDto } from './dto/create-asset.dto.js';

/** Collections whose records are tagged with asset ids (`assets: [...]`). */
const RECORD_COLLECTIONS = [
  'articles', 'fda_records', 'ema_records', 'trial_records', 'company_records',
  'publication_records', 'conference_records', 'patent_records', 'record_chunks',
];

/** Drop empty values, so unknown fields are absent rather than stored as null or "". */
const compact = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as T;

/**
 * Adding and removing assets (spec §5.2). Adding is the user's confirmation of
 * an identity card: the asset is created in `onboarding` and its onboarding
 * crawl starts. The model never calls this; only the user's click does.
 */
@Injectable()
export class AssetLifecycleService {
  private readonly logger = new Logger(AssetLifecycleService.name);

  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
    private readonly crawler: CrawlerClient,
    private readonly cache: CacheService,
  ) {}

  async create(dto: CreateAssetDto, user: AuthUser) {
    const id = slug(dto.name);
    if (!id) throw new BadRequestException({ code: 'INVALID_NAME', message: 'The asset name needs letters or digits.' });
    const session = dto.chatSessionId ? await findSession(this.db, dto.chatSessionId, user.id) : null;
    if (dto.chatSessionId && !session) throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Chat not found' });

    const coll = this.db.collection<AssetDoc>('assets');
    const existing = await coll.findOne({ _id: id });
    if (existing?.kind === 'primary') {
      throw new ConflictException({ code: 'ASSET_EXISTS', message: `${existing.name} is already tracked.`, id });
    }
    const now = new Date();
    const identity = {
      name: dto.name,
      aliases: dto.aliases.filter((a) => a.toLowerCase() !== dto.name.toLowerCase()),
      company: compact({ name: dto.company.name, website: dto.company.website, ir_url: dto.company.ir_url }),
      tags: compact({
        indications: dto.tags.indications,
        investigational_indications: dto.tags.investigational_indications ?? [],
        mechanism: dto.tags.mechanism,
        modality: dto.tags.modality,
      }),
      kind: 'primary' as const,
      status: 'onboarding' as const,
      created_by: { id: user.id, name: user.name },
      updated_at: now,
    };
    // A competitor asset being added on its own is promoted: same id, full onboarding crawl.
    if (existing) await coll.updateOne({ _id: id }, { $set: identity });
    else await coll.insertOne({ _id: id, ...identity, competitors: [], created_at: now } as AssetDoc);

    let job: Record<string, unknown>; // the crawl service's job: { id, asset, type, status, steps, ... }
    try {
      job = await this.crawler.createJob({ asset_id: id, type: 'onboard', requested_by: { id: user.id, name: user.name } });
    } catch (err) {
      // Nothing is collecting data for it: undo, so the user can simply try again.
      if (existing) await coll.replaceOne({ _id: id }, existing);
      else await coll.deleteOne({ _id: id });
      throw err;
    }
    await Promise.all([this.cache.bump('assets:ver'), this.cache.bump(`asset:${id}:ver`)]);
    if (session) {
      await addMessage(this.db, session, {
        role: 'assistant',
        content: `Started collecting data for **${dto.name}**. The asset page fills in as each step finishes.`,
        cards: [{ type: 'job', jobId: String(job.id), assetId: id, assetName: dto.name }],
      });
    }
    return { asset: await this.assets.detail(id), job };
  }

  /** Admin: remove an asset, its journey and its tags on records (records shared with other assets stay). */
  async remove(id: string) {
    const asset = await this.assets.getAsset(id);
    const running = await this.db.collection('jobs').find({ asset: id, status: { $in: ['queued', 'running'] } }).toArray();
    for (const job of running) {
      await this.crawler.cancelJob(String(job._id)).catch((err: Error) => this.logger.warn(`cancel ${job._id}: ${err.message}`));
    }
    await Promise.all([
      this.db.collection('assets').deleteOne({ _id: id as never }),
      this.db.collection('journey_events').deleteMany({ asset: id }),
      this.db.collection('crawl_ledger').deleteMany({ asset: id }),
      ...RECORD_COLLECTIONS.map((c) => this.db.collection(c).updateMany({ assets: id }, { $pull: { assets: id } as never })),
      this.db.collection('assets').updateMany({}, { $pull: { competitors: { id }, competitor_of: id } as never }),
      this.db.collection('chat_sessions').updateMany({ asset_id: id }, { $set: { asset_id: null } }),
    ]);
    await Promise.all([this.cache.bump('assets:ver'), this.cache.bump(`asset:${id}:ver`), ...(asset.competitor_of ?? []).map((p) => this.cache.bump(`asset:${p}:ver`))]);
  }
}
