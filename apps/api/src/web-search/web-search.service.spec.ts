import { Logger } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { WebSearchService } from './web-search.service.js';

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('t');
}, 180_000);
afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

const cite = (url: string, text: string, title = 'T') => ({ type: 'url_citation', url, title, start_index: 0, end_index: text.length });
const response = (...cites: [string, string][]) => ({
  output: [{ type: 'message', content: [{ type: 'output_text', text: cites.map(([, t]) => t).join('\n'), annotations: cites.map(([u, t]) => cite(u, t)) }] }],
});

function setup(env: Record<string, unknown>, create = vi.fn().mockResolvedValue(response())) {
  const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
  const config = { get: (k: string) => env[k] };
  const svc = new WebSearchService(db, config as never, { embed } as never);
  (svc as unknown as { openai: () => unknown }).openai = () => ({ responses: { create } });
  return { svc, create, embed };
}
const ON = { ANALYTICS_WEB_SEARCH: true, OPENAI_API_KEY: 'k', LLM_CHAT_MODEL: 'm' };

beforeEach(async () => {
  for (const c of ['web_records', 'record_chunks', 'assets']) await db.collection(c).deleteMany({});
});

describe('WebSearchService', () => {
  it('flag off or no key: no OpenAI call', async () => {
    for (const env of [{ ...ON, ANALYTICS_WEB_SEARCH: false }, { ...ON, OPENAI_API_KEY: '' }]) {
      const { svc, create } = setup(env);
      expect(await svc.search('q', { asset: 'a' })).toEqual({ enabled: false, results: [] });
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('restricts the tool to the allow-list (plus the asset IR host) and drops other cited hosts', async () => {
    await db.collection('assets').insertOne({ _id: 'a' as never, company: { name: 'Co', ir_url: 'https://ir.example.com/news' } });
    const create = vi.fn().mockResolvedValue(
      response(['https://www.fda.gov/x', 'FDA approved it.'], ['https://spam.com/y', 'Spam.'], ['https://clinicaltrials.gov.evil.com/z', 'Evil.'], ['https://pr.ir.example.com/q', 'IR news.']),
    );
    const { svc } = setup(ON, create);
    const out = await svc.search('q', { asset: 'a' });
    const tool = create.mock.calls[0]![0].tools[0];
    expect(tool.filters.allowed_domains).toEqual(expect.arrayContaining(['fda.gov', 'sec.gov', 'ir.example.com']));
    expect(out.enabled).toBe(true);
    expect(out.results.map((r) => r.domain)).toEqual(['fda.gov', 'pr.ir.example.com']);
    expect(out.results[0]).toMatchObject({ url: 'https://www.fda.gov/x', content: 'FDA approved it.' });
  });

  it("adds the asset's crawl_hints.domains to its allowed_domains, re-validated against the allow-list and IR host", async () => {
    await db.collection('assets').insertOne({
      _id: 'a' as never,
      company: { name: 'Co', ir_url: 'https://ir.example.com/news' },
      crawl_hints: { domains: ['www.accessdata.fda.gov', 'investors.ir.example.com', 'spam.com', 'fda.gov.evil.com', 42, ''] },
    });
    const create = vi.fn().mockResolvedValue(response(['https://accessdata.fda.gov/doc', 'Label.']));
    const { svc } = setup(ON, create);
    const out = await svc.search('q', { asset: 'a' });
    const allowed = create.mock.calls[0]![0].tools[0].filters.allowed_domains as string[];
    expect(allowed).toEqual(expect.arrayContaining(['fda.gov', 'ir.example.com', 'accessdata.fda.gov', 'investors.ir.example.com']));
    expect(allowed).not.toEqual(expect.arrayContaining(['spam.com']));
    expect(allowed).not.toContain('fda.gov.evil.com');
    expect(allowed).not.toContain(42);
    expect(out.results.map((r) => r.domain)).toEqual(['accessdata.fda.gov']);
  });

  it('addCrawlHints $addToSets only allowed hosts and is idempotent', async () => {
    await db.collection('assets').insertOne({ _id: 'a' as never, company: { ir_url: 'https://ir.example.com/news' } });
    const { svc } = setup(ON);
    const urls = ['https://www.accessdata.fda.gov/x', 'https://spam.com/y', 'https://pr.ir.example.com/q', 'not a url'];
    await svc.addCrawlHints('a', urls);
    await svc.addCrawlHints('a', urls);
    expect((await db.collection('assets').findOne({ _id: 'a' as never }))?.crawl_hints).toEqual({ domains: ['accessdata.fda.gov', 'pr.ir.example.com'] });
    await svc.addCrawlHints('a', ['https://spam.com/y']);
    expect((await db.collection('assets').findOne({ _id: 'a' as never }))?.crawl_hints.domains).toHaveLength(2);
  });

  it('persists web_records and chunks, and upserts by key adding assets', async () => {
    const long = 'word '.repeat(700);
    const create = vi.fn().mockResolvedValue(response(['https://www.fda.gov/x', long]));
    const { svc, embed } = setup(ON, create);
    const first = await svc.search('q', { asset: 'a' });
    const key = first.results[0]!.key;
    expect(key).toMatch(/^web:[0-9a-f]{40}$/);
    expect(await db.collection('web_records').findOne({ key })).toMatchObject({ url: 'https://www.fda.gov/x', domain: 'fda.gov', assets: ['a'] });
    const chunks = await db.collection('record_chunks').find({ record_key: key }).toArray();
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ collection: 'web_records', assets: ['a'], embedding: [0.1, 0.2], url: 'https://www.fda.gov/x' });
    expect(embed).toHaveBeenCalledTimes(chunks.length);

    await svc.search('q', { asset: 'b' });
    expect(await db.collection('web_records').countDocuments({})).toBe(1);
    expect((await db.collection('web_records').findOne({ key }))!.assets).toEqual(['a', 'b']);
    expect((await db.collection('record_chunks').findOne({ record_key: key }))!.assets).toEqual(['a', 'b']);
    expect(embed).toHaveBeenCalledTimes(chunks.length); // unchanged content is not re-embedded
  });

  it('a failed OpenAI call returns no results instead of throwing', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { svc } = setup(ON, vi.fn().mockRejectedValue(new Error('boom')));
    expect(await svc.search('q', { asset: 'a' })).toEqual({ enabled: true, results: [] });
    warn.mockRestore();
  });

  it('a failed store still returns the results found', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { svc } = setup(ON, vi.fn().mockResolvedValue(response(['https://www.fda.gov/x', 'FDA approved it.'])));
    (svc as unknown as { store: () => Promise<void> }).store = () => Promise.reject(new Error('db down'));
    const out = await svc.search('q', { asset: 'a' });
    expect(out.enabled).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('an embedding failure keeps the web record, drops its chunks, and still returns the results', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { svc, embed } = setup(ON, vi.fn().mockResolvedValue(response(['https://www.fda.gov/x', 'FDA approved it.'])));
    embed.mockRejectedValue(new Error('embeddings down'));
    const out = await svc.search('q', { asset: 'a' });
    expect(out.results).toHaveLength(1);
    expect(await db.collection('web_records').countDocuments({ key: out.results[0]!.key })).toBe(1);
    expect(await db.collection('record_chunks').countDocuments({ record_key: out.results[0]!.key })).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('indexing https://www.fda.gov/x failed'));
    warn.mockRestore();
  });

  it('a store failure on one page does not stop the others being stored', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { svc } = setup(ON, vi.fn().mockResolvedValue(response(['https://www.fda.gov/x', 'First.'], ['https://www.sec.gov/y', 'Second.'])));
    const real = (svc as unknown as { store: (r: { url: string }, a: string) => Promise<void> }).store.bind(svc);
    (svc as unknown as { store: unknown }).store = (r: { url: string }, a: string) => (r.url.includes('fda.gov') ? Promise.reject(new Error('db down')) : real(r, a));
    const out = await svc.search('q', { asset: 'a' });
    expect(out.results).toHaveLength(2);
    expect(await db.collection('web_records').find().toArray()).toEqual([expect.objectContaining({ url: 'https://www.sec.gov/y' })]);
    warn.mockRestore();
  });
});
