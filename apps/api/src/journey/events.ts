import type { Document } from 'mongodb';

export type Via = 'journey' | 'ai_events' | 'finalize' | 'user';
export interface SourceRef {
  collection: string;
  record_key: string;
}
export type EventV3 = Document & { id: string; via: Via };

export interface NoteDoc {
  _id: string;
  asset: string;
  date: string;
  branch?: string;
  category: string;
  tag: string;
  title: string;
  text: string;
  mode: 'manual' | 'ai';
  sources?: SourceRef[];
  by: { id: string; name: string };
  created_at: Date;
  updated_at?: Date;
}

const VIA: Record<string, Via> = { rule: 'journey', ai: 'ai_events', user: 'user' };
const INTERNAL = new Set(['_id', 'ai_links', 'enriched_at', 'merged_from', 'updated_at']);

/** A journey_events document as the v3 API returns it (DATA_CONTRACTS §A JourneyEventV3). */
export function toEventV3(doc: Document): EventV3 {
  const out: Document = { id: doc._id };
  for (const [k, v] of Object.entries(doc)) if (!INTERNAL.has(k)) out[k] = v;
  out.via = VIA[doc.origin as string] ?? 'journey';
  const links = [...new Set<string>([...(doc.links ?? []), ...(doc.ai_links ?? [])])].filter((l) => l !== doc._id);
  if (links.length) out.links = links;
  else delete out.links;
  return out as EventV3;
}

/** A team note as a journey event (via 'user'); notes are always in the key scope. */
export function noteToEvent(n: NoteDoc, today = new Date().toISOString().slice(0, 10)): EventV3 {
  return {
    id: n._id,
    asset: n.asset,
    date: n.date,
    type: 'note',
    category: n.category,
    title: n.title,
    summary: n.text,
    significance: 'Medium',
    is_milestone: n.date > today,
    ...(n.branch && { branch: n.branch }),
    sources: n.sources ?? [],
    via: 'user',
    key: true,
    user: { tag: n.tag, by: n.by, created_at: new Date(n.created_at).toISOString(), mode: n.mode },
  };
}

const TAB_BY_COLLECTION: Record<string, string> = {
  fda_records: 'regulatory',
  ema_records: 'regulatory',
  trial_records: 'clinical',
  publication_records: 'publications',
  conference_records: 'conferences',
  patent_records: 'patents',
  articles: 'news',
};

/** The asset tab a source record opens in (company records split by type); null for sources without a tab. */
export function recordTab(collection: string, recordType: string | undefined): string | null {
  if (collection === 'company_records') return recordType === 'press_release' ? 'company-ir' : 'documents';
  return TAB_BY_COLLECTION[collection] ?? null;
}
