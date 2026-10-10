import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import type { PrefsDto } from './prefs.dto.js';

export const DEFAULT_PREFS = { journeyView: 'h' as 'h' | 'v', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false } };
export type Prefs = typeof DEFAULT_PREFS;

/** In-app notifications (stored per user, fanned out at write time) and per-user preferences (DATA_CONTRACTS §B.5). */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(@Inject(MONGO_DB) private readonly db: Db) {}

  async onModuleInit() {
    await this.db.collection('notifications').createIndex({ user: 1, at: -1 });
    await this.db.collection('user_prefs').createIndex({ user: 1 }, { unique: true });
  }

  async prefs(user: string): Promise<Prefs> {
    const doc = await this.db.collection('user_prefs').findOne({ user });
    return { ...DEFAULT_PREFS, ...(doc && { journeyView: doc.journeyView ?? DEFAULT_PREFS.journeyView, sidebarCollapsed: doc.sidebarCollapsed ?? false }), notify: { ...DEFAULT_PREFS.notify, ...doc?.notify } };
  }

  async savePrefs(user: string, patch: PrefsDto): Promise<Prefs> {
    const set: Record<string, unknown> = {};
    if (patch.journeyView) set.journeyView = patch.journeyView;
    if (patch.sidebarCollapsed !== undefined) set.sidebarCollapsed = patch.sidebarCollapsed;
    for (const [k, v] of Object.entries(patch.notify ?? {})) if (v !== undefined) set[`notify.${k}`] = v;
    if (Object.keys(set).length) await this.db.collection('user_prefs').updateOne({ user }, { $set: set }, { upsert: true });
    return this.prefs(user);
  }

  /** Fan a notification out to active users whose preference `pref` is on. */
  async push(pref: keyof Prefs['notify'], kind: string, title: string, sub: string, link: string, exceptUser?: string): Promise<number> {
    const users = (await this.db.collection('users').find({ active: true }, { projection: { _id: 1 } }).toArray()).map((u) => String(u._id));
    const prefs = new Map((await this.db.collection('user_prefs').find({ user: { $in: users } }).toArray()).map((p) => [p.user as string, p.notify ?? {}]));
    const to = users.filter((u) => u !== exceptUser && ({ ...DEFAULT_PREFS.notify, ...prefs.get(u) } as Record<string, boolean>)[pref]);
    if (to.length) await this.db.collection('notifications').insertMany(to.map((user) => ({ user, kind, title, sub, link, read: false, at: new Date() })));
    return to.length;
  }

  /** Notify specific users (e.g. whoever starred an event). Not preference-gated: the user opted in by starring. Inactive users are skipped. */
  async pushTo(users: string[], kind: string, title: string, sub: string, link: string): Promise<number> {
    if (!users.length) return 0;
    const active = (await this.db.collection('users').find({ active: true, _id: { $in: users.filter((u) => ObjectId.isValid(u)).map((u) => new ObjectId(u)) } }, { projection: { _id: 1 } }).toArray()).map((u) => String(u._id));
    if (active.length) await this.db.collection('notifications').insertMany(active.map((user) => ({ user, kind, title, sub, link, read: false, at: new Date() })));
    return active.length;
  }

  async list(user: string) {
    const [items, unread] = await Promise.all([
      this.db.collection('notifications').find({ user }).sort({ at: -1 }).limit(30).toArray(),
      this.db.collection('notifications').countDocuments({ user, read: false }),
    ]);
    return { items: items.map(({ _id, user: _u, ...n }) => ({ id: String(_id), ...n })), unread };
  }

  async markRead(user: string, ids?: string[]) {
    const match: Record<string, unknown> = { user, read: false };
    if (ids?.length) match._id = { $in: ids.filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i)) };
    await this.db.collection('notifications').updateMany(match, { $set: { read: true } });
    return { unread: await this.db.collection('notifications').countDocuments({ user, read: false }) };
  }
}
