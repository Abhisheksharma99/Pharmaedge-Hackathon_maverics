import type { Db } from 'mongodb';
import { LlmService } from '../src/llm/llm.service.js';
import { NotesFinderService } from '../src/annotations/notes-finder.service.js';
import { WebSearchService } from '../src/web-search/web-search.service.js';
import { CacheService } from '../src/valkey/cache.service.js';
import { ValkeyService } from '../src/valkey/valkey.service.js';
import { MONGO_DB } from '../src/database/database.module.js';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

let ctx: TestContext;
let admin: Record<string, string>;
let analyst: Record<string, string>;
let db: Db;
const EV = 'ai:trep:https://example.com/a/b:0';
const enc = encodeURIComponent(EV);

const call = (cookies: Record<string, string>, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  ctx.app.inject({ method, url, cookies, payload });

beforeAll(async () => {
  ctx = await createTestApp();
  const login = async (email: string, password: string) => cookiesOf(await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } }));
  admin = await login(ADMIN.email, ADMIN.password);
  await call(admin, 'POST', '/api/users', { email: 'ana@example.com', name: 'Ana Lyst', password: 'analyst-password-1', role: 'analyst' });
  analyst = await login('ana@example.com', 'analyst-password-1');
  db = ctx.app.get<Db>(MONGO_DB);
  await db.collection('assets').insertOne({ _id: 'trep' as never, name: 'Treprostinil', kind: 'primary', status: 'ready', company: { name: 'UT' }, tags: {} });
  await db.collection('journey_events').insertOne({ _id: EV as never, asset: 'trep', origin: 'ai', date: '2021-03-31', title: 'T', category: 'regulatory', significance: 'High', key: true, sources: [] });
});
afterAll(() => closeTestApp(ctx));

describe('stars', () => {
  it('are per user and idempotent', async () => {
    expect((await call(admin, 'PUT', `/api/assets/trep/events/${enc}/star`)).statusCode).toBe(204);
    expect((await call(admin, 'PUT', `/api/assets/trep/events/${enc}/star`)).statusCode).toBe(204);
    expect((await call(admin, 'GET', '/api/assets/trep/annotations')).json().stars).toEqual([EV]);
    expect((await call(analyst, 'GET', '/api/assets/trep/annotations')).json().stars).toEqual([]);
    await call(admin, 'DELETE', `/api/assets/trep/events/${enc}/star`);
    expect((await call(admin, 'GET', '/api/assets/trep/annotations')).json().stars).toEqual([]);
  });

  it('404 for an unknown event', async () => {
    expect((await call(admin, 'PUT', '/api/assets/trep/events/nope/star')).statusCode).toBe(404);
  });
});

describe('real-length event ids (~250 chars)', () => {
  const LONG = `ai:trep:https://www.example.com/news/2024/${'very-long-path-segment/'.repeat(8)}story?id=1&x=2:0`;
  const lenc = encodeURIComponent(LONG);

  it('star, unstar and comment on them', async () => {
    expect(LONG.length).toBeGreaterThan(200);
    await db.collection('journey_events').insertOne({ _id: LONG as never, asset: 'trep', origin: 'ai', date: '2022-01-01', title: 'L', category: 'regulatory', significance: 'High', key: true, sources: [] });
    expect((await call(admin, 'PUT', `/api/assets/trep/events/${lenc}/star`)).statusCode).toBe(204);
    expect((await call(admin, 'GET', '/api/assets/trep/annotations')).json().stars).toContain(LONG);
    expect((await call(admin, 'DELETE', `/api/assets/trep/events/${lenc}/star`)).statusCode).toBe(204);
    const c = await call(admin, 'POST', `/api/assets/trep/events/${lenc}/comments`, { text: 'long one' });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ text: 'long one' });
  });
});

describe('comments', () => {
  it('are team-visible and deletable only by their author or an admin', async () => {
    const c = (await call(analyst, 'POST', `/api/assets/trep/events/${enc}/comments`, { text: 'Worth a look' })).json();
    expect(c).toMatchObject({ text: 'Worth a look', by: { name: 'Ana Lyst' } });
    expect((await call(admin, 'GET', '/api/assets/trep/annotations')).json().comments[EV]).toHaveLength(1);
    const mine = (await call(admin, 'POST', `/api/assets/trep/events/${enc}/comments`, { text: 'Admin note' })).json();
    expect((await call(analyst, 'DELETE', `/api/assets/trep/comments/${mine.id}`)).statusCode).toBe(403);
    expect((await call(admin, 'DELETE', `/api/assets/trep/comments/${c.id}`)).statusCode).toBe(204);
  });

  it('rejects empty or over-long text', async () => {
    expect((await call(admin, 'POST', `/api/assets/trep/events/${enc}/comments`, { text: '' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', `/api/assets/trep/events/${enc}/comments`, { text: 'x'.repeat(2001) })).statusCode).toBe(400);
  });
});

describe('notes', () => {
  const note = { date: '2005-04-27', branch: 'PAH', category: 'regulatory', tag: 'Missed by AI', title: 'Yutrepia approved', text: 'From the press', mode: 'manual' };

  it('creates a user event, files feedback for "Missed by AI", and enforces ownership', async () => {
    const created = (await call(analyst, 'POST', '/api/assets/trep/notes', note)).json();
    expect(created).toMatchObject({ via: 'user', title: 'Yutrepia approved', user: { tag: 'Missed by AI', by: { name: 'Ana Lyst' } } });
    expect(await db.collection('crawl_feedback').findOne({ note_id: created.id })).toMatchObject({ asset: 'trep', status: 'open' });
    expect((await call(admin, 'GET', '/api/assets/trep/annotations')).json().notes.map((n: { id: string }) => n.id)).toContain(created.id);
    const other = (await call(admin, 'POST', '/api/assets/trep/notes', { ...note, tag: 'Question' })).json();
    expect((await call(analyst, 'PATCH', `/api/assets/trep/notes/${other.id}`, { title: 'Mine now' })).statusCode).toBe(403);
    expect((await call(analyst, 'PATCH', `/api/assets/trep/notes/${created.id}`, { title: 'Yutrepia approved (FDA)' })).json().title).toBe('Yutrepia approved (FDA)');
    expect((await call(analyst, 'DELETE', `/api/assets/trep/notes/${created.id}`)).statusCode).toBe(204);
    expect(await db.collection('crawl_feedback').countDocuments({ note_id: created.id })).toBe(0);
  });

  it('deleting a resolved note removes the crawler-made event, never a pre-existing one it matched', async () => {
    const mk = async (title: string) => (await call(analyst, 'POST', '/api/assets/trep/notes', { ...note, title })).json().id as string;
    const made = await mk('Resolved with a crawler event');
    const matched = await mk('Resolved against an existing event');
    const madeId = `feedback:trep:${made}`;
    await db.collection('journey_events').insertOne({ _id: madeId as never, asset: 'trep', origin: 'feedback', via: 'finalize', date: '2005-04-27', title: 'Resolved', category: 'regulatory', significance: 'Medium', sources: [] });
    await db.collection('journey_notes').updateOne({ _id: made as never }, { $set: { resolved_event: madeId } });
    await db.collection('journey_notes').updateOne({ _id: matched as never }, { $set: { resolved_event: EV } });
    const ver = ctx.app.get(CacheService);
    const before = await ver.version('asset:trep:ver');

    expect((await call(analyst, 'DELETE', `/api/assets/trep/notes/${made}`)).statusCode).toBe(204);
    expect(await db.collection('journey_events').countDocuments({ _id: madeId as never })).toBe(0);
    expect(await db.collection('crawl_feedback').countDocuments({ note_id: made })).toBe(0);
    if (ctx.app.get(ValkeyService).isAvailable()) expect(await ver.version('asset:trep:ver')).toBe(before + 1);

    expect((await call(analyst, 'DELETE', `/api/assets/trep/notes/${matched}`)).statusCode).toBe(204);
    expect(await db.collection('journey_events').countDocuments({ _id: EV as never })).toBe(1);
  });

  it('validates fields', async () => {
    expect((await call(admin, 'POST', '/api/assets/trep/notes', { ...note, tag: 'Nope' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', '/api/assets/trep/notes', { ...note, date: '2005-4-1' })).statusCode).toBe(400);
  });

  it('only accepts known record collections as sources', async () => {
    expect((await call(admin, 'POST', '/api/assets/trep/notes', { ...note, sources: [{ collection: 'users', record_key: 'x' }] })).statusCode).toBe(400);
    expect((await call(admin, 'POST', '/api/assets/trep/notes', { ...note, sources: [{ collection: 'fda_records', record_key: 'x' }] })).statusCode).toBe(201);
  });
});

describe('notifications and prefs', () => {
  it('lists the current user\'s notifications and marks them read', async () => {
    const users = await db.collection('users').find().toArray();
    const adminId = String(users.find((u) => u.email === ADMIN.email)!._id);
    await db.collection('notifications').insertMany([
      { user: adminId, kind: 'high_event', title: 'A', sub: 's', link: '/assets/trep/overview', read: false, at: new Date() },
      { user: 'someone-else', kind: 'high_event', title: 'B', sub: 's', link: '/', read: false, at: new Date() },
    ]);
    const list = (await call(admin, 'GET', '/api/notifications')).json();
    expect(list.items.map((n: { title: string }) => n.title)).toEqual(['A']);
    expect(list.unread).toBe(1);
    expect((await call(admin, 'POST', '/api/notifications/read', {})).json().unread).toBe(0);
  });

  it('returns default prefs and saves partial updates per user', async () => {
    expect((await call(admin, 'GET', '/api/me/prefs')).json()).toEqual({ journeyView: 'h', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: false } });
    const saved = (await call(admin, 'PATCH', '/api/me/prefs', { journeyView: 'v', notify: { weeklyDigest: true } })).json();
    expect(saved).toEqual({ journeyView: 'v', sidebarCollapsed: false, notify: { highEvents: true, crawls: true, weeklyDigest: true } });
    expect((await call(analyst, 'GET', '/api/me/prefs')).json().journeyView).toBe('h');
    expect((await call(admin, 'PATCH', '/api/me/prefs', { journeyView: 'x' })).statusCode).toBe(400);
  });
});

describe('comment notifications', () => {
  const EV2 = 'ai:trep:https://example.com/notify:0';
  const enc2 = encodeURIComponent(EV2);
  let adminId: string;
  let analystId: string;

  beforeAll(async () => {
    const users = await db.collection('users').find().toArray();
    adminId = String(users.find((u) => u.email === ADMIN.email)!._id);
    analystId = String(users.find((u) => u.email === 'ana@example.com')!._id);
    await db.collection('journey_events').insertOne({ _id: EV2 as never, asset: 'trep', origin: 'ai', date: '2022-02-02', title: 'Starred event', category: 'regulatory', significance: 'High', key: true, sources: [] });
    await db.collection('notifications').deleteMany({});
  });

  it('notifies everyone who starred the event except the commenter', async () => {
    await call(admin, 'PUT', `/api/assets/trep/events/${enc2}/star`);
    await call(analyst, 'PUT', `/api/assets/trep/events/${enc2}/star`);
    expect((await call(analyst, 'POST', `/api/assets/trep/events/${enc2}/comments`, { text: 'Look at this' })).statusCode).toBe(201);
    const mine = (await call(admin, 'GET', '/api/notifications')).json().items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'comment', title: 'Ana Lyst commented on a starred event', sub: 'Treprostinil · Starred event', link: `/assets/trep/overview?focus=${enc2}`, read: false });
    expect((await call(analyst, 'GET', '/api/notifications')).json().items).toHaveLength(0);
  });

  it('notifies nobody when only the commenter starred the event', async () => {
    await call(admin, 'DELETE', `/api/assets/trep/events/${enc2}/star`);
    await db.collection('notifications').deleteMany({});
    await call(analyst, 'POST', `/api/assets/trep/events/${enc2}/comments`, { text: 'Again' });
    expect(await db.collection('notifications').countDocuments({ user: { $in: [adminId, analystId] } })).toBe(0);
  });
});

describe('POST /assets/:id/notes/find', () => {
  let llm: LlmService;
  let web: WebSearchService;
  const find = (payload: object, as = admin) => call(as, 'POST', '/api/assets/trep/notes/find', payload);

  beforeAll(async () => {
    llm = ctx.app.get(LlmService, { strict: false });
    web = ctx.app.get(WebSearchService, { strict: false });
    await db.collection('journey_events').insertOne({ _id: 'rule:trep:tyvaso' as never, asset: 'trep', origin: 'rule', date: '2021-03-31', title: 'FDA approves Tyvaso DPI for PH-ILD', summary: 'Dry powder inhaled treprostinil approved.', category: 'regulatory', significance: 'High', key: true, sources: [] });
    await db.collection('fda_records').insertOne({ record_key: 'NDA213005-ORIG-1', title: 'Yutrepia (treprostinil) inhalation powder approval letter', date: '2025-05-23', assets: ['trep'], url: 'https://fda.gov/x' });
    await db.collection('articles').insertOne({ url: 'https://news.example.com/yutrepia', title: 'Liquidia wins Yutrepia approval', content: 'FDA approved Yutrepia on May 23 2025.', date: '2025-05-24', assets: ['trep'] });
    // No Atlas vector index in the in-memory test DB.
    vi.spyOn(llm, 'embed').mockRejectedValue(new Error('no embeddings'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(llm, 'embed').mockRejectedValue(new Error('no embeddings'));
  });

  it('exists: returns the journey event that already matches', async () => {
    const json = vi.spyOn(llm, 'json');
    const res = await find({ title: 'Tyvaso DPI approved for PH-ILD', date: '2021-04-10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'exists', event: { id: 'rule:trep:tyvaso', title: 'FDA approves Tyvaso DPI for PH-ILD', date: '2021-03-31', category: 'regulatory', via: 'journey' }, note: 'This looks like an event already on the journey (3 matching terms).' });
    expect(json).not.toHaveBeenCalled();
  });

  it('is not fooled by weak matches: generic words, short titles, or a different product', async () => {
    vi.spyOn(llm, 'json').mockResolvedValue({ supported: false, title: '', date: '', category: 'regulatory', summary: '', branch: null, source_ids: [] } as never);
    for (const title of ['Yutrepia approved', 'approved', 'US OK', 'FDA nod', 'Tyvaso']) {
      const res = (await find({ title })).json();
      expect(res.kind, title).not.toBe('exists');
    }
    // Same product, different happening: the claim's action word must be in the event too.
    await db.collection('journey_events').insertOne({ _id: 'ai:trep:sales' as never, asset: 'trep', origin: 'ai', date: '2025-06-30', title: 'Tyvaso DPI Q2 2025 net sales $315.2M', summary: 'Tyvaso DPI net sales grew.', category: 'commercial', significance: 'Medium', key: true, sources: [] });
    expect((await find({ title: 'Tyvaso DPI approved', date: '2025-07-01' })).json().kind).not.toBe('exists');
    await db.collection('journey_events').deleteOne({ _id: 'ai:trep:sales' as never });
  });

  it('found: drops an ungrounded date to the analyst\'s date, or gives up without one', async () => {
    const ungrounded = { supported: true, title: 'FDA approves Yutrepia', date: '2025-06-30', category: 'regulatory', summary: 's', branch: null, source_ids: ['P1'] };
    vi.spyOn(llm, 'json').mockResolvedValue(ungrounded as never);
    expect((await find({ title: 'Yutrepia approved', date: '2025-05-20' })).json()).toMatchObject({ kind: 'found', event: { date: '2025-05-20' } });
    expect((await find({ title: 'Yutrepia approved' })).json().kind).toBe('none');
    // Grounded but outside the +-18 month window of the analyst's date: use theirs.
    vi.spyOn(llm, 'json').mockResolvedValue({ ...ungrounded, date: '2025-05-23' } as never);
    expect((await find({ title: 'Yutrepia approved', date: '2023-01-01' })).json().kind).not.toBe('exists');
  });

  it('found: keeps records without a date when a date is given, and a grounded date', async () => {
    await db.collection('web_records').insertOne({ key: 'web:undated', record_key: 'web:undated', url: 'https://fda.gov/q', title: 'Quasar', content: 'Quasar was cleared.', assets: ['trep'] });
    vi.spyOn(llm, 'json').mockResolvedValue({ supported: true, title: 'Quasar approved', date: '2025-05-23', category: 'regulatory', summary: 's', branch: null, source_ids: ['P1'] } as never);
    const res = (await find({ title: 'Quasar', date: '2025-05-20' })).json();
    expect(res).toMatchObject({ kind: 'found', event: { sources: [{ collection: 'web_records', record_key: 'web:undated' }] } });
    await db.collection('web_records').deleteOne({ key: 'web:undated' });
  });

  it('found: proposes one event grounded in record passages, with their sources', async () => {
    const json = vi.spyOn(llm, 'json').mockImplementation(async (_s, user) => {
      expect(user).toContain('Yutrepia');
      return { supported: true, title: 'FDA approves Yutrepia (Liquidia)', date: '2025-05-23', category: 'regulatory', summary: 'Dry-powder treprostinil approved.', branch: null, source_ids: ['P1', 'P2', 'P9'] } as never;
    });
    const res = await find({ title: 'Yutrepia approved', branch: 'PH-ILD' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe('found');
    expect(body.event).toMatchObject({ title: 'FDA approves Yutrepia (Liquidia)', date: '2025-05-23', category: 'regulatory', summary: 'Dry-powder treprostinil approved.', branch: 'PH-ILD' });
    expect(body.event.sources).toHaveLength(2);
    expect(body.event.sources).toEqual(expect.arrayContaining([{ collection: 'fda_records', record_key: 'NDA213005-ORIG-1' }, { collection: 'articles', record_key: 'https://news.example.com/yutrepia' }]));
    expect(body.note).toMatch(/^Found (1 FDA record and 1 news article|1 news article and 1 FDA record)\./);
    expect(json).toHaveBeenCalledTimes(1);
    // The returned event can be saved as a note as is.
    const e = body.event;
    expect((await call(admin, 'POST', '/api/assets/trep/notes', { date: e.date, branch: e.branch, category: e.category, tag: 'Missed by AI', title: e.title, text: e.summary, mode: 'ai', sources: e.sources })).statusCode).toBe(201);
  });

  it('found via the web when the records have nothing, and saves the used pages as web_records', async () => {
    vi.spyOn(web, 'search').mockResolvedValue({ enabled: true, results: [{ key: 'web:abc', url: 'https://www.fda.gov/news/zzz', domain: 'fda.gov', title: 'Zebrafish', content: 'Zebrafish approved on 2024-01-02.', fetched_at: '2026-01-01T00:00:00Z' }] });
    vi.spyOn(llm, 'json').mockResolvedValue({ supported: true, title: 'Zebrafish approved', date: '2024-01-02', category: 'regulatory', summary: 'Approved.', branch: null, source_ids: ['P1'] } as never);
    const body = (await find({ title: 'Zebrafish' })).json();
    expect(body).toMatchObject({ kind: 'found', event: { sources: [{ collection: 'web_records', record_key: 'web:abc' }] } });
    expect(body.note).toContain('web page');
    expect(await db.collection('web_records').findOne({ key: 'web:abc' })).toMatchObject({ url: 'https://www.fda.gov/news/zzz', assets: ['trep'] });
    expect((await db.collection('assets').findOne({ _id: 'trep' as never }))?.crawl_hints).toEqual({ domains: ['fda.gov'] });
  });

  it('none: nothing supports it (no passages, web off)', async () => {
    const json = vi.spyOn(llm, 'json');
    const res = (await find({ title: 'Quokka merger announced' })).json();
    expect(res.kind).toBe('none');
    expect(res.event).toBeUndefined();
    expect(res.note).toContain('web search is off');
    expect(json).not.toHaveBeenCalled();
  });

  it('none: the model rejects the passages or cites nothing', async () => {
    vi.spyOn(llm, 'json').mockResolvedValue({ supported: true, title: 'X', date: '2025-05-23', category: 'regulatory', summary: 'x', branch: null, source_ids: [] } as never);
    expect((await find({ title: 'Yutrepia approved' })).json().kind).toBe('none');
    vi.spyOn(llm, 'json').mockResolvedValue({ supported: false, title: '', date: '', category: 'regulatory', summary: '', branch: null, source_ids: ['P1'] } as never);
    expect((await find({ title: 'Yutrepia approved' })).json().kind).toBe('none');
  });

  it('degrades to none (200) when the LLM throws or returns garbage', async () => {
    vi.spyOn(web, 'search').mockResolvedValue({ enabled: true, results: [] });
    for (const impl of [() => Promise.reject(new Error('LLM_UNAVAILABLE')), () => Promise.reject(new SyntaxError('Unexpected end of JSON input')), () => Promise.resolve(null)]) {
      vi.spyOn(llm, 'json').mockImplementation(impl as never);
      const res = await find({ title: 'Yutrepia approval', date: '2025-05-23' });
      expect(res.statusCode).toBe(200);
      expect(res.json().kind).toBe('none');
    }
    vi.spyOn(llm, 'json').mockRejectedValue(new Error('boom'));
    expect((await find({ title: 'Yutrepia approval', date: '2025-05-23' })).json().note).toContain("couldn't check this right now");
  });

  it('degrades to none (200) when the web search itself throws', async () => {
    vi.spyOn(web, 'search').mockRejectedValue(new Error('search exploded'));
    const json = vi.spyOn(llm, 'json');
    const res = await find({ title: 'Quokka merger announced' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'none' });
    expect(json).not.toHaveBeenCalled();
  });

  it('still proposes the event when saving the used web pages fails', async () => {
    vi.spyOn(web, 'search').mockResolvedValue({ enabled: true, results: [{ key: 'web:fail', url: 'https://www.fda.gov/news/fail', domain: 'fda.gov', title: 'Narwhal', content: 'Narwhal approved on 2024-02-03.', fetched_at: '2026-01-01T00:00:00Z' }] });
    vi.spyOn(llm, 'json').mockResolvedValue({ supported: true, title: 'Narwhal approved', date: '2024-02-03', category: 'regulatory', summary: 'Approved.', branch: null, source_ids: ['P1'] } as never);
    const finder = ctx.app.get(NotesFinderService, { strict: false }) as unknown as { saveWebRecords: () => Promise<void> };
    vi.spyOn(finder, 'saveWebRecords').mockRejectedValue(new Error('db down'));
    const res = await find({ title: 'Narwhal' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'found', event: { title: 'Narwhal approved', sources: [{ collection: 'web_records', record_key: 'web:fail' }] } });
    expect(await db.collection('web_records').countDocuments({ key: 'web:fail' })).toBe(0);
  });

  it('web search off with nothing in the records says so and does not call the model', async () => {
    vi.spyOn(web, 'search').mockResolvedValue({ enabled: false, results: [] });
    const json = vi.spyOn(llm, 'json');
    const res = (await find({ title: 'Quokka merger announced' })).json();
    expect(res).toMatchObject({ kind: 'none' });
    expect(res.note).toContain('web search is off');
    expect(json).not.toHaveBeenCalled();
  });

  it('validates the body and requires auth', async () => {
    expect((await find({})).statusCode).toBe(400);
    expect((await find({ title: '' })).statusCode).toBe(400);
    expect((await find({ title: 'x'.repeat(201) })).statusCode).toBe(400);
    expect((await find({ title: 'ok', date: '2025-5-1' })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/assets/trep/notes/find', payload: { title: 'ok' } })).statusCode).toBe(401);
    expect((await call(admin, 'POST', '/api/assets/nope/notes/find', { title: 'ok' })).statusCode).toBe(404);
  });
});
