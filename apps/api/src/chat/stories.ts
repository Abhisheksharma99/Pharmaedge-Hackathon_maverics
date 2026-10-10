import { BadRequestException, Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import type { AuthUser } from '../auth/auth.types.js';
import type { StorySpec } from '../assets/story.js';
import { MONGO_DB } from '../database/database.module.js';
import { AccessPolicy } from './access-policy.js';

/**
 * Journey stories Asset AI built for a user (`stories`, one doc per story, private to its owner). A story keeps its
 * question, spec (focus window, filters, comparison) and the model's notes; the timeline itself is recomputed from
 * the stored data each time it is opened (StoryService), so it always shows the latest evidence.
 */

export const STORY_COLLECTION = 'stories';
const MAX_NOTES = 12;
const NOTE_MAX = 400;
const NAME_MAX = 60;
/** Stories kept per user: the oldest beyond this are dropped, so a chat loop cannot grow the collection unbounded. */
const MAX_STORIES = 200;

export interface StoryNote {
  id: string;
  text: string;
  /** Journey events the note explains (it is pinned to them). */
  eventIds: string[];
}

export interface StoryDoc {
  _id: string;
  user_id: string;
  asset_id: string;
  title: string;
  question: string | null;
  spec: StorySpec;
  notes: StoryNote[];
  /** Names the model gave the computed chapters (chapter id → name). */
  chapter_names: Record<string, string>;
  created_at: Date;
  updated_at: Date;
}

export const toStory = (s: StoryDoc) => ({
  id: s._id, assetId: s.asset_id, title: s.title, question: s.question, spec: s.spec, notes: s.notes,
  chapterNames: s.chapter_names, createdAt: s.created_at, updatedAt: s.updated_at,
});

@Injectable()
export class StoryStore implements OnModuleInit {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly policy: AccessPolicy,
  ) {}

  private get coll() {
    return this.db.collection<StoryDoc>(STORY_COLLECTION);
  }

  async onModuleInit() {
    await this.coll.createIndex({ user_id: 1, asset_id: 1, updated_at: -1 });
  }

  async create(userId: string, assetId: string, input: { title: string; question?: string | null; spec: StorySpec }): Promise<StoryDoc> {
    const now = new Date();
    const doc: StoryDoc = {
      _id: randomUUID(), user_id: userId, asset_id: assetId, title: input.title.slice(0, 160), question: input.question?.slice(0, 500) ?? null,
      spec: input.spec, notes: [], chapter_names: {}, created_at: now, updated_at: now,
    };
    await this.coll.insertOne(doc);
    const old = await this.coll.find({ user_id: userId }, { projection: { _id: 1 } }).sort({ updated_at: -1 }).skip(MAX_STORIES).toArray();
    if (old.length) await this.coll.deleteMany({ _id: { $in: old.map((s) => s._id) } });
    return doc;
  }

  async list(user: AuthUser, assetId?: string) {
    const allowed = await this.policy.allowedAssets(user.id);
    const docs = await this.coll
      .find({ user_id: user.id, asset_id: assetId ? (allowed.has(assetId) ? assetId : '') : { $in: [...allowed] } }, { projection: { notes: 0 } })
      .sort({ updated_at: -1 }).limit(50).toArray();
    return docs.map((s) => ({ id: s._id, assetId: s.asset_id, title: s.title, question: s.question, updatedAt: s.updated_at }));
  }

  /** The user's own story of an asset they may read; anything else is "not found". */
  async get(userId: string, id: string): Promise<StoryDoc> {
    const doc = await this.coll.findOne({ _id: id, user_id: userId });
    if (!doc || !(await this.policy.allowedAssets(userId)).has(doc.asset_id)) {
      throw new NotFoundException({ code: 'STORY_NOT_FOUND', message: 'Story not found' });
    }
    return doc;
  }

  /**
   * Pin the model's notes to journey events of the story (its asset, and the asset it is compared with) and name its
   * chapters. Notes are replaced as a set (the model writes them once per answer); any other event id is refused.
   */
  async annotate(userId: string, id: string, input: { notes: { text: string; event_ids: string[] }[]; chapterNames?: Record<string, string> }): Promise<StoryDoc> {
    const story = await this.get(userId, id);
    const bad = (why: string): never => {
      throw new BadRequestException({ code: 'INVALID_NOTES', message: why });
    };
    if (input.notes.length > MAX_NOTES) bad(`At most ${MAX_NOTES} notes`);
    const wanted = [...new Set(input.notes.flatMap((n) => n.event_ids))];
    const known = new Set(
      (await this.db
        .collection('journey_events')
        .find({ asset: { $in: [story.asset_id, ...(story.spec.compare ? [story.spec.compare] : [])] }, _id: { $in: wanted as never[] } }, { projection: { _id: 1 } })
        .toArray()).map((e) => String(e._id)),
    );
    const unknown = wanted.filter((e) => !known.has(e));
    if (unknown.length) bad(`Not events of this story's assets: ${unknown.slice(0, 5).join(', ')}`);
    const notes: StoryNote[] = input.notes.map((n) => {
      const text = n.text.trim();
      if (!text || text.length > NOTE_MAX) bad(`A note needs 1-${NOTE_MAX} characters`);
      if (!n.event_ids.length) bad('A note must cite at least one event');
      return { id: randomUUID(), text, eventIds: [...new Set(n.event_ids)].slice(0, 6) };
    });
    const names: Record<string, string> = { ...story.chapter_names };
    for (const [k, v] of Object.entries(input.chapterNames ?? {})) {
      if (!/^ch-\d{1,2}$/.test(k) || !v.trim() || v.length > NAME_MAX) bad(`Chapter names: ids like "ch-1", 1-${NAME_MAX} characters`);
      names[k] = v.trim();
    }
    const saved = await this.coll.findOneAndUpdate({ _id: id, user_id: userId }, { $set: { notes, chapter_names: names, updated_at: new Date() } }, { returnDocument: 'after' });
    return saved!;
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.get(user.id, id);
    await this.coll.deleteOne({ _id: id, user_id: user.id });
  }
}
