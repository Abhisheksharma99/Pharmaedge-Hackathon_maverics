import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import OpenAI from 'openai';
import type { Env } from '../config/env.js';
import { MONGO_DB } from '../database/database.module.js';
import { LlmService } from '../llm/llm.service.js';

export interface WebResult {
  key: string;
  url: string;
  domain: string;
  title: string;
  content: string;
  fetched_at: string;
}

/** Public, citable sources only (ANALYTICS_PIPELINE §2); the asset's company IR domain is added per search. */
export const ALLOWED_DOMAINS = ['fda.gov', 'open.fda.gov', 'ema.europa.eu', 'clinicaltrials.gov', 'pubmed.ncbi.nlm.nih.gov', 'sec.gov'];

// Same chunking as the crawler's index step (crawler/ai/index.py).
const CHUNK = 1500;
const OVERLAP = 200;
const MAX_CHUNKS = 40;

const chunks = (text: string) => {
  const out: string[] = [];
  for (let start = 0; start < text.length && out.length < MAX_CHUNKS; start += CHUNK - OVERLAP) out.push(text.slice(start, start + CHUNK));
  return out;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};
const onList = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * Real web search through the OpenAI Responses API `web_search` tool, restricted to the allow-list and gated by
 * ANALYTICS_WEB_SEARCH. Every cited page is stored as a `web_records` doc and indexed in `record_chunks`, so the
 * next vector search finds it without another web call.
 */
@Injectable()
export class WebSearchService implements OnModuleInit {
  private readonly logger = new Logger(WebSearchService.name);
  private client: OpenAI | null = null;

  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly config: ConfigService<Env, true>,
    private readonly llm: LlmService,
  ) {}

  async onModuleInit() {
    await this.db.collection('web_records').createIndex({ key: 1 }, { unique: true });
  }

  private enabled() {
    return !!this.config.get('ANALYTICS_WEB_SEARCH', { infer: true }) && !!this.config.get('OPENAI_API_KEY', { infer: true });
  }

  /** Overridable in tests. */
  protected openai(): OpenAI {
    return (this.client ??= new OpenAI({
      apiKey: this.config.get('OPENAI_API_KEY', { infer: true }),
      baseURL: this.config.get('OPENAI_BASE_URL', { infer: true }) || undefined,
      maxRetries: 2,
      timeout: 90_000,
    }));
  }

  async search(query: string, opts: { asset: string; domains?: string[]; limit?: number }): Promise<{ enabled: boolean; results: WebResult[] }> {
    if (!this.enabled() || !query.trim()) return { enabled: this.enabled(), results: [] };
    const allowed = await this.allowList(opts.asset, opts.domains);
    const limit = Math.max(1, Math.min(opts.limit ?? 5, 10));
    let found: Omit<WebResult, 'key' | 'fetched_at'>[];
    try {
      found = await this.run(query, allowed);
    } catch (err) {
      this.logger.warn(`web search failed: ${(err as Error).message}`);
      return { enabled: true, results: [] };
    }
    const fetched_at = new Date().toISOString();
    const results = found.slice(0, limit).map((r) => ({ ...r, key: `web:${createHash('sha1').update(r.url).digest('hex')}`, fetched_at }));
    for (const r of results) {
      try {
        await this.store(r, opts.asset);
      } catch (err) {
        this.logger.warn(`storing ${r.url} failed: ${(err as Error).message}`);
      }
    }
    return { enabled: true, results };
  }

  private async allowList(asset: string, extra?: string[]) {
    const doc = await this.db.collection('assets').findOne({ _id: asset as never }, { projection: { company: 1 } });
    const ir = (doc?.company as { ir_url?: string } | undefined)?.ir_url;
    const irHost = ir ? hostOf(ir) : null;
    const base = [...ALLOWED_DOMAINS, ...(irHost ? [irHost] : [])];
    // A caller may narrow the list, never widen it.
    const narrowed = extra?.length ? base.filter((d) => extra.some((e) => onList(d, [e.toLowerCase()]) || onList(e.toLowerCase(), [d]))) : base;
    return narrowed.length ? narrowed : base;
  }

  private async run(query: string, allowed: string[]) {
    const res = await this.openai().responses.create({
      model: this.config.get('LLM_CHAT_MODEL', { infer: true }),
      input: query,
      tools: [{ type: 'web_search', filters: { allowed_domains: allowed } }],
      tool_choice: 'auto',
    });
    const byUrl = new Map<string, { url: string; domain: string; title: string; parts: string[] }>();
    for (const item of res.output) {
      if (item.type !== 'message') continue;
      for (const part of item.content) {
        if (part.type !== 'output_text') continue;
        for (const a of part.annotations) {
          if (a.type !== 'url_citation') continue;
          const domain = hostOf(a.url);
          if (!domain || !onList(domain, allowed)) continue;
          const url = a.url.split('#')[0]!;
          // The paragraph that carries the citation is the evidence for that page.
          const from = part.text.lastIndexOf('\n', a.start_index) + 1;
          const to = part.text.indexOf('\n', a.end_index);
          const passage = part.text.slice(from, to === -1 ? undefined : to).replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '').trim();
          const entry = byUrl.get(url) ?? { url, domain, title: a.title || url, parts: [] };
          if (passage && !entry.parts.includes(passage)) entry.parts.push(passage);
          byUrl.set(url, entry);
        }
      }
    }
    return [...byUrl.values()]
      .map((e) => ({ url: e.url, domain: e.domain, title: e.title, content: e.parts.join('\n\n') }))
      .filter((e) => e.content);
  }

  /** Upsert the page and (re)index its chunks. Unchanged content is not re-embedded; only the asset tag is added. */
  private async store(r: WebResult, asset: string) {
    const records = this.db.collection('web_records');
    const chunkColl = this.db.collection('record_chunks');
    const before = await records.findOne({ key: r.key }, { projection: { content: 1 } });
    await records.updateOne(
      { key: r.key },
      { $set: { url: r.url, domain: r.domain, fetched_at: r.fetched_at, title: r.title, content: r.content }, $addToSet: { assets: asset } },
      { upsert: true },
    );
    if (before?.content === r.content && (await chunkColl.countDocuments({ collection: 'web_records', record_key: r.key }, { limit: 1 }))) {
      await chunkColl.updateMany({ collection: 'web_records', record_key: r.key }, { $addToSet: { assets: asset } });
      return;
    }
    const assets = ((await records.findOne({ key: r.key }, { projection: { assets: 1 } }))?.assets as string[]) ?? [asset];
    try {
      const parts = chunks(`${r.title}\n${r.content}`.trim());
      const docs = [];
      for (const [i, text] of parts.entries()) {
        docs.push({
          _id: `web_records|${r.key}|${i}` as never, collection: 'web_records', record_key: r.key, chunk: i, text,
          embedding: await this.llm.embed(text), assets, title: r.title, date: r.fetched_at.slice(0, 10),
          record_type: 'web_records', url: r.url, indexed_at: new Date(),
        });
      }
      await chunkColl.deleteMany({ collection: 'web_records', record_key: r.key });
      if (docs.length) await chunkColl.insertMany(docs);
    } catch (err) {
      // The record is kept; it is simply not searchable until a later search stores it again.
      this.logger.warn(`indexing ${r.url} failed: ${(err as Error).message}`);
    }
  }
}
