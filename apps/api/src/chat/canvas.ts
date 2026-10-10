import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Db, Document } from 'mongodb';
import type { AuthUser } from '../auth/auth.types.js';
import { MONGO_DB } from '../database/database.module.js';
import { AccessPolicy } from './access-policy.js';

/**
 * Journey canvas: an editable tree of an asset's journey (`canvases`, one doc per canvas, private to its owner).
 *
 * Asset AI builds the tree deterministically from the stored journey events (build_journey_tree: the model picks
 * grouping and filters, never the content), the app opens it, and the user edits it: rename, add notes, delete,
 * collapse. Saves carry the version they were based on; a stale one is refused (409) instead of overwriting.
 *
 * Live: the canvas is saved empty and opened first, then each top-level branch is streamed to the app as it is
 * built (`onProgress`). Node ids are derived from the data (category, year, journey event id), so `refresh` can
 * merge the latest events into an edited canvas: renames, notes, folds and deletions are kept, new events are added
 * (and reported so the app can highlight them), events no longer in the data move to a "review" group.
 */

export const NODE_KINDS = ['asset', 'group', 'event', 'note'] as const;
export const CANVAS_COLLECTION = 'canvases';
const MAX_NODES = 800;
const MAX_DEPTH = 8;
const MAX_EVENTS = 300;

export interface CanvasNode {
  id: string;
  kind: (typeof NODE_KINDS)[number];
  label: string;
  /** Free text the user attaches to a node. */
  note?: string;
  date?: string;
  category?: string;
  significance?: string;
  upcoming?: boolean;
  collapsed?: boolean;
  /** An event no longer in the stored data (or no longer matching the canvas filters): kept for the user to review. */
  stale?: boolean;
  /** The journey event and its first source record (opens the record in the app). */
  eventId?: string;
  source?: { collection: string; record_key: string };
  children: CanvasNode[];
}

export type GroupBy = 'category' | 'year';

/** What the canvas shows: kept so the canvas can be refreshed from the latest data with the same filters. */
export interface CanvasSpec {
  groupBy: GroupBy;
  significance: string[];
  category?: string[];
  from?: string;
  to?: string;
}

export interface CanvasDoc {
  _id: string;
  user_id: string;
  asset_id: string;
  title: string;
  tree: CanvasNode;
  version: number;
  /** building while the branches stream in; absent on canvases made before streaming. */
  status?: 'building' | 'ready';
  spec?: CanvasSpec;
  /** Journey events the user deleted from the canvas: a refresh never adds them back. */
  dismissed?: string[];
  created_at: Date;
  updated_at: Date;
}

/** Progress of a build, streamed to the app as it happens (chat stream events canvas_start / canvas_nodes). */
export type CanvasProgress =
  | { type: 'canvas_start'; canvasId: string; assetId: string; title: string; tree: CanvasNode }
  | { type: 'canvas_nodes'; canvasId: string; parentId: string; nodes: CanvasNode[] };

const DEFAULT_SPEC: CanvasSpec = { groupBy: 'category', significance: ['High', 'Medium'] };
export const STALE_GROUP_ID = 'stale';

export function specMatch(spec: CanvasSpec): Document {
  const match: Document = { significance: { $in: spec.significance } };
  if (spec.category?.length) match.category = { $in: spec.category };
  if (spec.from || spec.to) match.date = { ...(spec.from ? { $gte: spec.from } : {}), ...(spec.to ? { $lte: spec.to } : {}) };
  return match;
}
const CATEGORY_ORDER = ['regulatory', 'clinical', 'safety', 'company', 'ip'];
const CATEGORY_LABEL: Record<string, string> = { regulatory: 'Regulatory', clinical: 'Clinical', safety: 'Safety', company: 'Company', ip: 'Patents & IP' };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Node id of a journey event: stable across builds, within the id charset `cleanTree` accepts. */
export const eventNodeId = (eventId: string) => `e-${createHash('sha1').update(eventId).digest('hex').slice(0, 16)}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'other';

/**
 * Asset -> category -> year -> events (or asset -> year -> events), newest first; older years start collapsed.
 * Ids come from the data (`asset`, `c-regulatory`, `c-regulatory-2024`, `y-2024`, `e-<hash of event id>`).
 */
export function buildJourneyTree(asset: { _id: string; name: string }, events: Document[], groupBy: GroupBy): CanvasNode {
  const root: CanvasNode = { id: 'asset', kind: 'asset', label: asset.name, children: [] };
  root.children = journeyBranches(events, groupBy);
  return root;
}

/** The asset's top-level branches (one per category, or per year), in display order. */
export function journeyBranches(events: Document[], groupBy: GroupBy): CanvasNode[] {
  const leaf = (e: Document): CanvasNode => ({
    id: eventNodeId(String(e._id)), kind: 'event', label: clip(String(e.title ?? 'Untitled event'), 200),
    ...(e.date ? { date: e.date } : {}), ...(e.category ? { category: e.category } : {}), ...(e.significance ? { significance: e.significance } : {}),
    ...(e.is_milestone ? { upcoming: true } : {}),
    eventId: String(e._id), ...(e.sources?.[0] ? { source: { collection: e.sources[0].collection, record_key: e.sources[0].record_key } } : {}),
    children: [],
  });
  const byYear = (prefix: string, list: Document[]): CanvasNode[] => {
    const years = new Map<string, Document[]>();
    for (const e of list) {
      const y = /^\d{4}/.test(e.date ?? '') ? String(e.date).slice(0, 4) : 'Undated';
      years.set(y, [...(years.get(y) ?? []), e]);
    }
    return [...years.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([year, es], i) => ({
      id: `${prefix}${slug(year)}`, kind: 'group' as const, label: year, ...(i >= 3 ? { collapsed: true } : {}),
      children: es.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))).map(leaf),
    }));
  };
  if (groupBy === 'year') return byYear('y-', events);
  const rank = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  const categories = [...new Set(events.map((e) => String(e.category ?? 'other')))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return categories.map((c) => ({
    id: `c-${slug(c)}`, kind: 'group' as const, label: CATEGORY_LABEL[c] ?? c, category: c,
    children: byYear(`c-${slug(c)}-`, events.filter((e) => String(e.category ?? 'other') === c)),
  }));
}

const walkNodes = function* (n: CanvasNode, parent: CanvasNode | null = null): Generator<[CanvasNode, CanvasNode | null]> {
  yield [n, parent];
  for (const c of n.children) yield* walkNodes(c, n);
};

/**
 * The latest tree (`fresh`) with the user's edits on `saved` carried over. Nodes are matched by id, events also by
 * event id (canvases from before stable ids). Kept from the user: labels, notes, folds, their own note nodes (under
 * the same parent, else the root) and deletions (`dismissed` events are left out). Events the user had that are no
 * longer in `fresh` go to a "No longer in the data" group for review. `added` lists the ids of new nodes.
 */
export function mergeTree(fresh: CanvasNode, saved: CanvasNode, dismissed: Set<string>): { tree: CanvasNode; added: string[]; stale: number } {
  const savedById = new Map<string, CanvasNode>();
  const savedByEvent = new Map<string, CanvasNode>();
  const parentOf = new Map<string, string>();
  for (const [n, parent] of walkNodes(saved)) {
    savedById.set(n.id, n);
    if (n.eventId) savedByEvent.set(n.eventId, n);
    if (parent) parentOf.set(n.id, parent.id);
  }
  const added: string[] = [];
  const placed = new Set<string>(); // saved node ids carried over
  const freshEvents = new Set<string>();
  for (const [n] of walkNodes(fresh)) if (n.eventId) freshEvents.add(n.eventId);

  const merge = (f: CanvasNode): CanvasNode | null => {
    if (f.eventId && dismissed.has(f.eventId)) return null;
    const s = savedById.get(f.id) ?? (f.eventId ? savedByEvent.get(f.eventId) : undefined);
    const children = f.children.map(merge).filter((c): c is CanvasNode => c !== null);
    const notes = (s?.children ?? []).filter((c) => c.kind === 'note');
    if (f.kind === 'group' && f.children.length && !children.length && !notes.length) return null; // all of it deleted by the user
    if (!s) added.push(f.id);
    else placed.add(s.id);
    notes.forEach((c) => placed.add(c.id));
    // The data comes from `f`; what the user decided (label, note, fold) from `s`.
    const node: CanvasNode = { ...f, children: [...children, ...notes] };
    if (s) {
      node.label = s.label;
      if (s.note) node.note = s.note;
      if (s.collapsed) node.collapsed = true;
      else delete node.collapsed;
    }
    return node;
  };
  const tree = merge(fresh)!;

  // The user's notes whose parent is gone, and their events no longer in the data.
  const orphans: CanvasNode[] = [];
  const stale: CanvasNode[] = [];
  for (const [n] of walkNodes(saved)) {
    if (placed.has(n.id) || n.kind === 'asset' || n.id === STALE_GROUP_ID) continue;
    if (n.kind === 'note' && !placed.has(parentOf.get(n.id) ?? '')) orphans.push(n);
    if (n.kind === 'event' && n.eventId && !freshEvents.has(n.eventId) && !dismissed.has(n.eventId)) stale.push({ ...n, stale: true, children: [] });
  }
  tree.children.push(...orphans);
  if (stale.length) {
    const previous = savedById.get(STALE_GROUP_ID);
    tree.children.push({ id: STALE_GROUP_ID, kind: 'group', label: previous?.label ?? 'No longer in the data (review)', children: stale });
  }
  return { tree, added, stale: stale.length };
}

const count = (t: CanvasNode): number => 1 + t.children.reduce((s, c) => s + count(c), 0);

/**
 * A client-sent tree, rebuilt from the known fields only (anything else is dropped) and bounded in size, depth and
 * text length. Throws 400 on a malformed tree.
 */
export function cleanTree(input: unknown): CanvasNode {
  const ids = new Set<string>();
  const bad = (why: string): never => {
    throw new BadRequestException({ code: 'INVALID_CANVAS', message: `Invalid canvas: ${why}` });
  };
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : undefined);
  const walk = (raw: unknown, depth: number): CanvasNode => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('a node must be an object');
    const r = raw as Record<string, unknown>;
    if (depth > MAX_DEPTH) bad(`deeper than ${MAX_DEPTH} levels`);
    if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id) || ids.has(r.id)) bad('node ids must be unique short identifiers');
    ids.add(r.id as string);
    if (ids.size > MAX_NODES) bad(`more than ${MAX_NODES} nodes`);
    if (!NODE_KINDS.includes(r.kind as CanvasNode['kind'])) bad('unknown node kind');
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label || label.length > 300) bad('a label must have 1-300 characters');
    if (r.children !== undefined && !Array.isArray(r.children)) bad('children must be a list');
    const src = r.source as { collection?: unknown; record_key?: unknown } | undefined;
    const source = src && /^[a-z_]{1,40}$/.test(String(src.collection)) && text(src.record_key, 700)
      ? { collection: String(src.collection), record_key: String(src.record_key) } : undefined;
    return {
      id: r.id as string, kind: r.kind as CanvasNode['kind'], label,
      ...(text(r.note, 2000) ? { note: r.note as string } : {}),
      ...(text(r.date, 32) ? { date: r.date as string } : {}),
      ...(text(r.category, 32) ? { category: r.category as string } : {}),
      ...(text(r.significance, 16) ? { significance: r.significance as string } : {}),
      ...(r.upcoming === true ? { upcoming: true } : {}),
      ...(r.collapsed === true ? { collapsed: true } : {}),
      ...(r.stale === true ? { stale: true } : {}),
      ...(text(r.eventId, 700) ? { eventId: r.eventId as string } : {}),
      ...(source ? { source } : {}),
      children: ((r.children as unknown[] | undefined) ?? []).map((c) => walk(c, depth + 1)),
    };
  };
  const root = walk(input, 1);
  if (root.kind !== 'asset') bad('the root must be the asset');
  return root;
}

export const toCanvas = (c: CanvasDoc) => ({
  id: c._id, assetId: c.asset_id, title: c.title, tree: c.tree, version: c.version, status: c.status ?? 'ready',
  createdAt: c.created_at, updatedAt: c.updated_at,
});

const eventIds = (t: CanvasNode): Set<string> => new Set([...walkNodes(t)].map(([n]) => n.eventId).filter((e): e is string => !!e));

@Injectable()
export class CanvasService implements OnModuleInit {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly policy: AccessPolicy,
  ) {}

  private get coll() {
    return this.db.collection<CanvasDoc>(CANVAS_COLLECTION);
  }

  async onModuleInit() {
    await this.coll.createIndex({ user_id: 1, asset_id: 1, updated_at: -1 });
  }

  /** The newest events matching the spec (bounded), plus the canvas's own events that still match it. */
  private async events(assetId: string, spec: CanvasSpec, keep: string[] = []) {
    const coll = this.db.collection('journey_events');
    const match = { ...specMatch(spec), asset: assetId };
    const projection = { title: 1, date: 1, category: 1, significance: 1, is_milestone: 1, sources: { $slice: 1 } };
    const [newest, kept, total] = await Promise.all([
      coll.find(match, { projection }).sort({ date: -1 }).limit(MAX_EVENTS).toArray(),
      keep.length ? coll.find({ ...match, _id: { $in: keep as never[] } }, { projection }).toArray() : Promise.resolve([]),
      coll.countDocuments(match),
    ]);
    const byId = new Map([...newest, ...kept].map((e) => [String(e._id), e]));
    return { docs: [...byId.values()], total };
  }

  /**
   * Build a canvas from the asset's stored journey events and save it for the user (nothing is saved without
   * events). The empty canvas is saved and announced first, then each top-level branch as it is built.
   */
  async build(userId: string, asset: { _id: string; name: string }, opts: { spec: CanvasSpec; title?: string }, onProgress?: (p: CanvasProgress) => void) {
    const { docs, total } = await this.events(asset._id, opts.spec);
    if (!docs.length) return { canvas: null, events: 0, total };
    const now = new Date();
    const doc: CanvasDoc = {
      _id: randomUUID(), user_id: userId, asset_id: asset._id,
      title: opts.title?.trim() || `${asset.name} journey by ${opts.spec.groupBy}`,
      tree: { id: 'asset', kind: 'asset', label: asset.name, children: [] }, version: 1, status: 'building', spec: opts.spec, dismissed: [],
      created_at: now, updated_at: now,
    };
    await this.coll.insertOne(doc);
    try {
      onProgress?.({ type: 'canvas_start', canvasId: doc._id, assetId: asset._id, title: doc.title, tree: doc.tree });
      for (const branch of journeyBranches(docs, opts.spec.groupBy)) {
        doc.tree.children.push(branch);
        onProgress?.({ type: 'canvas_nodes', canvasId: doc._id, parentId: 'asset', nodes: [branch] });
      }
      doc.status = 'ready';
      doc.updated_at = new Date();
      await this.coll.updateOne({ _id: doc._id }, { $set: { tree: doc.tree, status: 'ready', updated_at: doc.updated_at } });
    } catch (err) {
      await this.coll.deleteOne({ _id: doc._id }); // never leave a half-built canvas behind
      throw err;
    }
    return { canvas: doc, events: docs.length, total };
  }

  /**
   * Merge the latest stored events into the canvas, keeping the user's edits (mergeTree). Based on `version` like a
   * save; nothing is written when nothing changed.
   */
  async refresh(user: AuthUser, id: string, version: number) {
    const doc = await this.get(user, id);
    if (doc.version !== version) throw new ConflictException({ code: 'CANVAS_CONFLICT', message: 'This canvas was changed elsewhere. Reload it before updating.' });
    const asset = await this.db.collection<{ _id: string; name: string }>('assets').findOne({ _id: doc.asset_id }, { projection: { name: 1 } });
    const spec = doc.spec ?? DEFAULT_SPEC;
    const { docs } = await this.events(doc.asset_id, spec, [...eventIds(doc.tree)]);
    const fresh = buildJourneyTree({ _id: doc.asset_id, name: asset?.name ?? doc.tree.label }, docs, spec.groupBy);
    const { tree, added, stale } = mergeTree(fresh, doc.tree, new Set(doc.dismissed ?? []));
    if (JSON.stringify(tree) === JSON.stringify(doc.tree)) return { canvas: doc, added: [], stale, changed: false };
    const saved = await this.coll.findOneAndUpdate(
      { _id: id, user_id: user.id, version },
      { $set: { tree, updated_at: new Date(), ...(doc.spec ? {} : { spec }) }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (!saved) throw new ConflictException({ code: 'CANVAS_CONFLICT', message: 'This canvas was changed elsewhere. Reload it before updating.' });
    return { canvas: saved, added, stale, changed: true };
  }

  async list(user: AuthUser, assetId?: string) {
    const allowed = await this.policy.allowedAssets(user.id);
    const docs = await this.coll
      .find({ user_id: user.id, asset_id: assetId ? (allowed.has(assetId) ? assetId : '') : { $in: [...allowed] } }, { projection: { tree: 0 } })
      .sort({ updated_at: -1 }).limit(50).toArray();
    return docs.map((c) => ({ id: c._id, assetId: c.asset_id, title: c.title, version: c.version, updatedAt: c.updated_at }));
  }

  /** The user's own canvas of an asset they may read; anything else is "not found". */
  async get(user: AuthUser, id: string): Promise<CanvasDoc> {
    const doc = await this.coll.findOne({ _id: id, user_id: user.id });
    if (!doc || !(await this.policy.allowedAssets(user.id)).has(doc.asset_id)) {
      throw new NotFoundException({ code: 'CANVAS_NOT_FOUND', message: 'Canvas not found' });
    }
    return doc;
  }

  async save(user: AuthUser, id: string, input: { title: string; tree: unknown; version: number }): Promise<CanvasDoc> {
    const before = await this.get(user, id);
    const tree = cleanTree(input.tree);
    // Events the user removed stay removed when the canvas is refreshed from the latest data.
    const kept = eventIds(tree);
    const removed = [...eventIds(before.tree)].filter((e) => !kept.has(e));
    const saved = await this.coll.findOneAndUpdate(
      { _id: id, user_id: user.id, version: input.version },
      { $set: { title: input.title, tree, updated_at: new Date() }, $inc: { version: 1 }, ...(removed.length ? { $addToSet: { dismissed: { $each: removed } } } : {}) },
      { returnDocument: 'after' },
    );
    if (!saved) throw new ConflictException({ code: 'CANVAS_CONFLICT', message: 'This canvas was changed elsewhere. Reload it before saving.' });
    return saved;
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.get(user, id);
    await this.coll.deleteOne({ _id: id, user_id: user.id });
  }

  /** Summary of a tree for the model and the chat card: top-level groups with their event counts. */
  static groups(tree: CanvasNode): { label: string; events: number }[] {
    const events = (t: CanvasNode): number => (t.kind === 'event' ? 1 : 0) + t.children.reduce((s, c) => s + events(c), 0);
    return tree.children.map((g) => ({ label: g.label, events: events(g) }));
  }

  static size = count;
}
