/** Asset AI shapes shared by the store, the tools and the streamed turn (spec §6). */

export interface Citation {
  n: number;
  title: string;
  /** Human label of the source (PubMed, ClinicalTrials.gov, FDA, ...). */
  source: string;
  date: string;
  url: string | null;
  assetId: string;
  assetName: string;
  collection: string;
  recordKey: string;
  /** Asset-page tab that shows the record. */
  tab: string;
}

export interface TimelineCardEvent {
  id: string;
  assetId: string;
  assetName: string;
  date: string;
  title: string;
  category: string;
  significance: string;
  is_milestone: boolean;
  sources: { collection: string; record_key: string }[];
}

export type Card =
  | { type: 'identity'; identity: Record<string, unknown> }
  | { type: 'job'; jobId: string; assetId: string; assetName: string }
  | { type: 'comparison'; title: string; columns: { id: string; name: string; company: string }[]; rows: { label: string; values: string[] }[] }
  | { type: 'timeline'; title: string; assetId: string; events: TimelineCardEvent[] };

export interface ChatSessionDoc {
  _id: string;
  user_id: string;
  asset_id: string | null;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export interface ChatMessageDoc {
  _id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  cards: Card[];
  citations: Citation[];
  follow_ups: string[];
  tool_calls?: { name: string; args: unknown; summary: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; model: string };
  created_at: Date;
}

/** One line of the streamed turn (application/x-ndjson). */
export type StreamEvent =
  | { type: 'tool_call'; id: string; name: string; label: string }
  | { type: 'tool_result'; id: string; name: string; summary: string }
  | { type: 'card'; card: Card }
  | { type: 'token'; text: string }
  | { type: 'answer'; message: ReturnType<typeof toMessage> }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' };

export const toMessage = (m: ChatMessageDoc) => ({
  id: m._id,
  role: m.role,
  content: m.content,
  cards: m.cards ?? [],
  citations: m.citations ?? [],
  followUps: m.follow_ups ?? [],
  createdAt: m.created_at,
});

export const toSession = (s: ChatSessionDoc) => ({
  id: s._id,
  title: s.title,
  assetId: s.asset_id,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
});
