import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Db, Document } from 'mongodb';
import { AssetsService } from '../assets/assets.service.js';
import { SOURCE_TABS, listOmit } from '../assets/source-registry.js';
import { MONGO_DB } from '../database/database.module.js';
import { noteToEvent, recordTab, toEventV3, type EventV3, type NoteDoc, type SourceRef } from './events.js';

const BRANCH_FIELDS = ['id', 'label', 'full', 'color', 'off', 'trunk', 'from', 'why', 'status', 'ended', 'origin', 'partner', 'start'];
const brief = (e: Document | undefined) => (e ? { id: e._id ?? e.id, title: e.title, date: e.date } : null);

@Injectable()
export class JourneyService {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
  ) {}

  branches(id: string) {
    return this.assets.cached(id, 'branches', {}, async () => {
      await this.assets.getAsset(id);
      const docs = await this.db.collection('asset_branches').find({ asset: id }).toArray();
      docs.sort((a, b) => Number(!!b.trunk) - Number(!!a.trunk) || String(a.start ?? '').localeCompare(String(b.start ?? '')));
      return docs.map((b) => Object.fromEntries(BRANCH_FIELDS.filter((k) => k in b).map((k) => [k, b[k]])));
    });
  }

  async event(assetId: string, eventId: string) {
    await this.assets.getAsset(assetId);
    const doc = await this.db.collection('journey_events').findOne({ _id: eventId as never, asset: assetId });
    let event: EventV3;
    if (doc) event = toEventV3(doc);
    else {
      const note = await this.db.collection<NoteDoc>('journey_notes').findOne({ _id: eventId, asset: assetId });
      if (!note) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Event not found' });
      event = noteToEvent(note);
    }
    const refs = new Map<string, SourceRef>();
    for (const r of [...(event.sources ?? []), ...(event.merged_sources ?? [])] as SourceRef[]) refs.set(`${r.collection}|${r.record_key}`, r);
    const records = (await Promise.all([...refs.values()].slice(0, 40).map((r) => this.record(r)))).filter(Boolean);

    type Slot = { _id: string; date: string; title: string; branch?: string; key?: boolean };
    const [events, notes] = await Promise.all([
      this.db.collection<Slot>('journey_events').find({ asset: assetId }, { projection: { date: 1, title: 1, branch: 1, key: 1 } }).toArray(),
      this.db.collection<NoteDoc>('journey_notes').find({ asset: assetId }).toArray(),
    ]);
    // Team notes are key events in the same lanes, so they take part in neighbours and branch position.
    const all: Slot[] = [...events, ...notes.map((n) => ({ _id: n._id, date: n.date, title: n.title, branch: n.branch, key: true }))].sort(
      (a, b) => a.date.localeCompare(b.date) || a._id.localeCompare(b._id),
    );
    const pool = event.key ? all.filter((e) => e.key || e._id === eventId) : all;
    const i = pool.findIndex((e) => e._id === eventId);
    const lane = pool.filter((e) => (e.branch ?? null) === (event.branch ?? null));
    const j = lane.findIndex((e) => e._id === eventId);
    return {
      event,
      records,
      neighbors: { prev: i > 0 ? brief(pool[i - 1]) : null, next: i >= 0 && i < pool.length - 1 ? brief(pool[i + 1]) : null },
      branchStats: { index: j + 1, total: lane.length, prevSameBranch: j > 0 ? brief(lane[j - 1]) : null },
    };
  }

  private async record(ref: SourceRef) {
    const keyField = ref.collection === 'articles' ? 'url' : 'record_key';
    // A collection with a tab returns the record as that tab's list does (company_records' two tabs omit the same fields).
    const listTab = recordTab(ref.collection, undefined);
    const projection = listTab ? listOmit(SOURCE_TABS[listTab]!) : { title: 1, date: 1, url: 1, record_type: 1, source: 1, name_of_medicine: 1 };
    const doc = await this.db.collection(ref.collection).findOne({ [keyField]: ref.record_key }, { projection });
    if (!doc) return null;
    return {
      ...(listTab && doc),
      collection: ref.collection,
      key: ref.record_key,
      tab: recordTab(ref.collection, doc.record_type as string | undefined),
      title: (doc.title as string) ?? (doc.name_of_medicine as string) ?? ref.record_key,
      date: (doc.date as string) ?? '',
      url: (doc.url as string) ?? null,
      record_type: (doc.record_type as string) ?? null,
      source: (doc.source as string) ?? null,
    };
  }
}
