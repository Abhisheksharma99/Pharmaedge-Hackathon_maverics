import type { Db } from 'mongodb';

/**
 * Audit trail of Asset AI turns (`chat_audit`): who asked, what the tools were asked and what they returned as
 * RECORD IDS (never source text or answer text), authorization and validation decisions, verification findings,
 * models and usage. Retained AUDIT_RETENTION_DAYS (TTL index on created_at).
 */
export interface TurnAudit {
  _id: string;
  session_id: string;
  user_id: string;
  asset_in_view: string | null;
  created_at: Date;
  model: string;
  latency_ms?: number;
  /** Time to the first streamed answer text (tool rounds included). */
  first_token_ms?: number;
  outcome?: 'answered' | 'failed' | 'cancelled';
  allowed_assets: number;
  tool_calls: { name: string; args: unknown; status: 'ok' | 'invalid' | 'denied' | 'error' | 'skipped' | 'timeout'; detail?: string; ms?: number }[];
  records: string[];
  verification?: { kind: string; detail: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; cached_tokens: number };
}

export const AUDIT_COLLECTION = 'chat_audit';

export async function ensureAuditIndexes(db: Db, retentionDays: number): Promise<void> {
  const coll = db.collection(AUDIT_COLLECTION);
  await coll.createIndex({ created_at: 1 }, { expireAfterSeconds: retentionDays * 86400, name: 'audit_ttl' });
  await coll.createIndex({ user_id: 1, created_at: -1 });
}
