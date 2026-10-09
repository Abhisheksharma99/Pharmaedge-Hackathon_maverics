import type { Db } from 'mongodb';
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
