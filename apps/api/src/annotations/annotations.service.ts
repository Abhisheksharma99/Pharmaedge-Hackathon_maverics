import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { AssetsService } from '../assets/assets.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { MONGO_DB } from '../database/database.module.js';
import { noteToEvent, type NoteDoc } from '../journey/events.js';
import { NotificationsService } from '../me/notifications.service.js';
import { CacheService } from '../valkey/cache.service.js';
import type { CommentDto, NoteDto, NotePatchDto } from './annotations.dto.js';

interface CommentDoc {
  _id: string;
  asset: string;
  event: string;
  by: { id: string; name: string };
  text: string;
  at: Date;
}

const comment = (c: CommentDoc) => ({ id: c._id, by: c.by, at: c.at.toISOString(), text: c.text });
const canEdit = (user: AuthUser, by: { id: string }) => user.role === 'admin' || by.id === user.id;

/** Stars (per user), comments and team notes on journey events (DATA_CONTRACTS §B.3). */
@Injectable()
export class AnnotationsService implements OnModuleInit {
  private readonly logger = new Logger(AnnotationsService.name);

  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit() {
    await Promise.all([
      this.db.collection('event_stars').createIndex({ user: 1, event: 1 }, { unique: true }),
      this.db.collection('event_stars').createIndex({ asset: 1, user: 1 }),
      this.db.collection('event_comments').createIndex({ asset: 1, event: 1, at: 1 }),
      this.db.collection('journey_notes').createIndex({ asset: 1, date: 1 }),
      this.db.collection('crawl_feedback').createIndex({ asset: 1, status: 1 }),
    ]);
  }

  /** The event (or note) must exist on this asset. */
  private async requireEvent(asset: string, event: string) {
    await this.assets.getAsset(asset);
    const found =
      (await this.db.collection('journey_events').countDocuments({ _id: event as never, asset }, { limit: 1 })) ||
      (await this.db.collection('journey_notes').countDocuments({ _id: event as never, asset }, { limit: 1 }));
    if (!found) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Event not found' });
  }

  async annotations(asset: string, user: AuthUser) {
    await this.assets.getAsset(asset);
    const [stars, comments, notes] = await Promise.all([
      this.db.collection('event_stars').find({ asset, user: user.id }).toArray(),
      this.db.collection<CommentDoc>('event_comments').find({ asset }).sort({ at: 1 }).toArray(),
      this.db.collection<NoteDoc>('journey_notes').find({ asset }).sort({ date: 1 }).toArray(),
    ]);
    const byEvent: Record<string, ReturnType<typeof comment>[]> = {};
    for (const c of comments) (byEvent[c.event] ??= []).push(comment(c));
    return { stars: stars.map((s) => s.event as string), comments: byEvent, notes: notes.map((n) => noteToEvent(n)) };
  }

  async star(asset: string, event: string, user: AuthUser, on: boolean) {
    await this.requireEvent(asset, event);
    if (on) await this.db.collection('event_stars').updateOne({ user: user.id, event }, { $setOnInsert: { asset, created_at: new Date() } }, { upsert: true });
    else await this.db.collection('event_stars').deleteOne({ user: user.id, event });
  }

  async addComment(asset: string, event: string, user: AuthUser, dto: CommentDto) {
    await this.requireEvent(asset, event);
    const doc: CommentDoc = { _id: randomUUID(), asset, event, by: { id: user.id, name: user.name }, text: dto.text.trim(), at: new Date() };
    await this.db.collection<CommentDoc>('event_comments').insertOne(doc);
    await this.notifyStarrers(asset, event, user);
    return comment(doc);
  }

  /** A comment on a starred event notifies everyone who starred it, except the commenter. */
  private async notifyStarrers(asset: string, event: string, commenter: AuthUser) {
    try {
      const starrers = (await this.db.collection('event_stars').find({ asset, event, user: { $ne: commenter.id } }).toArray()).map((s) => s.user as string);
      if (!starrers.length) return;
      const doc = (await this.db.collection('journey_events').findOne({ _id: event as never, asset }, { projection: { title: 1 } })) ?? (await this.db.collection('journey_notes').findOne({ _id: event as never, asset }, { projection: { title: 1 } }));
      const assetName = (await this.assets.getAsset(asset)).name;
      await this.notifications.pushTo(starrers, 'comment', `${commenter.name} commented on a starred event`, `${assetName} · ${doc?.title ?? 'Journey event'}`, `/assets/${asset}/overview?focus=${encodeURIComponent(event)}`);
    } catch (err) {
      // The comment is saved; a failed notification must not fail it.
      this.logger.warn(`comment notification failed: ${(err as Error).message}`);
    }
  }

  async deleteComment(asset: string, id: string, user: AuthUser) {
    const doc = await this.db.collection<CommentDoc>('event_comments').findOne({ _id: id, asset });
    if (!doc) throw new NotFoundException({ code: 'COMMENT_NOT_FOUND', message: 'Comment not found' });
    if (!canEdit(user, doc.by)) throw new ForbiddenException({ code: 'NOT_AUTHOR', message: 'Only the author or an admin can delete this comment.' });
    await this.db.collection('event_comments').deleteOne({ _id: id as never });
  }

  async addNote(asset: string, user: AuthUser, dto: NoteDto) {
    await this.assets.getAsset(asset);
    const note: NoteDoc = { _id: `note:${randomUUID()}`, asset, ...dto, sources: dto.sources ?? [], by: { id: user.id, name: user.name }, created_at: new Date() };
    await this.db.collection<NoteDoc>('journey_notes').insertOne(note);
    if (note.tag === 'Missed by AI') await this.fileFeedback(note);
    return noteToEvent(note);
  }

  async updateNote(asset: string, id: string, user: AuthUser, dto: NotePatchDto) {
    const note = await this.ownNote(asset, id, user);
    const set = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    await this.db.collection<NoteDoc>('journey_notes').updateOne({ _id: id }, { $set: { ...set, updated_at: new Date() } });
    const updated = { ...note, ...set } as NoteDoc;
    if (updated.tag === 'Missed by AI' && note.tag !== 'Missed by AI') await this.fileFeedback(updated);
    return noteToEvent(updated);
  }

  async deleteNote(asset: string, id: string, user: AuthUser) {
    const note = await this.ownNote(asset, id, user);
    // The crawler made `feedback:<asset>:<note>` for a resolved "Missed by AI" note; it goes with the note.
    // A pre-existing journey event the note merely matched (any other id / origin) is never touched.
    const eventId = `feedback:${asset}:${id}`;
    const ownEvent = note.resolved_event === eventId ? await this.db.collection('journey_events').deleteOne({ _id: eventId as never, asset, origin: 'feedback' }) : null;
    await Promise.all([
      this.db.collection('journey_notes').deleteOne({ _id: id as never }),
      this.db.collection('event_stars').deleteMany({ event: id }),
      this.db.collection('event_comments').deleteMany({ event: id }),
      this.db.collection('crawl_feedback').deleteMany({ note_id: id }),
    ]);
    if (ownEvent?.deletedCount) await this.cache.bump(`asset:${asset}:ver`);
  }

  private async ownNote(asset: string, id: string, user: AuthUser) {
    const note = await this.db.collection<NoteDoc>('journey_notes').findOne({ _id: id, asset });
    if (!note) throw new NotFoundException({ code: 'NOTE_NOT_FOUND', message: 'Note not found' });
    if (!canEdit(user, note.by)) throw new ForbiddenException({ code: 'NOT_AUTHOR', message: 'Only the author or an admin can change this note.' });
    return note;
  }

  /** "Missed by AI" notes are read by the crawler's finalize to re-check (DATA_CONTRACTS §D crawl_feedback). */
  private fileFeedback(note: NoteDoc) {
    return this.db.collection('crawl_feedback').insertOne({
      asset: note.asset, note_id: note._id, title: note.title, text: note.text, date: note.date, sources: note.sources ?? [], status: 'open', created_at: new Date(),
    });
  }
}
