import type { Db } from 'mongodb';
import { MONGO_DB } from '../src/database/database.module.js';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

let ctx: TestContext;
let cookies: Record<string, string>;
let db: Db;
const AI_ID = 'ai:trep:https://example.com/a/b:0';

beforeAll(async () => {
  ctx = await createTestApp();
  cookies = cookiesOf(await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN.email, password: ADMIN.password } }));
  db = ctx.app.get<Db>(MONGO_DB);
  await db.collection('assets').insertOne({ _id: 'trep' as never, name: 'Treprostinil', kind: 'primary', status: 'ready', company: { name: 'UT' }, tags: {} });
  await db.collection('journey_events').insertMany([
    { _id: 'rule:approval:a' as never, asset: 'trep', origin: 'rule', date: '2002-05-21', title: 'FDA approves Remodulin', category: 'regulatory', significance: 'High', is_milestone: false, key: true, branch: 'PAH', links: ['rule:start:b'], sources: [{ collection: 'fda_records', record_key: 'fda:1' }] },
    { _id: 'rule:start:b' as never, asset: 'trep', origin: 'rule', date: '2017-02-03', title: 'Phase 3 trial started: INCREASE', category: 'clinical', significance: 'High', is_milestone: false, key: true, branch: 'PH-ILD', sources: [] },
    { _id: AI_ID as never, asset: 'trep', origin: 'ai', date: '2021-03-31', title: 'Tyvaso approved for PH-ILD', category: 'regulatory', significance: 'High', is_milestone: false, key: true, branch: 'PH-ILD', ai_links: ['rule:start:b'], enriched_at: new Date(), sources: [{ collection: 'company_records', record_key: 'pr:1' }], merged_sources: [{ collection: 'articles', record_key: 'https://news/x' }] },
    { _id: 'rule:label:c' as never, asset: 'trep', origin: 'rule', date: '2016-08-12', title: 'Label update', category: 'regulatory', significance: 'Low', is_milestone: false, key: false, branch: 'PAH', sources: [] },
  ]);
  await db.collection('asset_branches').insertMany([
    { _id: 'trep:PH-ILD' as never, asset: 'trep', id: 'PH-ILD', label: 'PH-ILD', full: 'PH-ILD', color: '#0b7a6f', off: 1, trunk: false, from: 'PAH', why: 'INCREASE', status: 'Approved · US', ended: null, origin: 'ai', start: '2017-02-03', aliases: ['ph-ild'], members: ['NCT1'] },
    { _id: 'trep:PAH' as never, asset: 'trep', id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', off: 0, trunk: true, from: null, status: 'Approved · US', ended: null, origin: 'ai', start: '1998-10-01', aliases: ['pah'], members: [] },
  ]);
  await db.collection('fda_records').insertOne({ record_key: 'fda:1', record_type: 'fda_submission', title: 'NDA021272', date: '2002-05-21', assets: ['trep'] });
  await db.collection('company_records').insertOne({ record_key: 'pr:1', record_type: 'press_release', title: 'UT announces', date: '2021-03-31', url: 'https://ut/pr', assets: ['trep'] });
  await db.collection('articles').insertOne({ url: 'https://news/x', title: 'News x', date: '2021-04-01', assets: ['trep'] });
});
afterAll(() => closeTestApp(ctx));

const get = (url: string) => ctx.app.inject({ method: 'GET', url, cookies });

describe('timeline v3', () => {
  it('returns v3 fields, via and merged links, without internal fields', async () => {
    const { events, total } = (await get('/api/assets/trep/timeline')).json();
    expect(total).toBe(4);
    const ai = events.find((e: { id: string }) => e.id === AI_ID);
    expect(ai).toMatchObject({ via: 'ai_events', branch: 'PH-ILD', links: ['rule:start:b'] });
    expect(ai).not.toHaveProperty('ai_links');
    expect(ai).not.toHaveProperty('enriched_at');
  });

  it('filters by key scope and branch', async () => {
    expect((await get('/api/assets/trep/timeline?scope=key')).json().total).toBe(3);
    expect((await get('/api/assets/trep/timeline?scope=key&branch=PH-ILD')).json().events.map((e: { id: string }) => e.id).sort()).toEqual([AI_ID, 'rule:start:b'].sort());
  });

  it('merges team notes outside the cache', async () => {
    await get('/api/assets/trep/timeline?scope=key'); // warm the cache
    await db.collection('journey_notes').insertOne({ _id: 'note:1' as never, asset: 'trep', date: '2005-04-27', branch: 'PAH', category: 'company', tag: 'Important', title: 'Board meeting', text: 'x', mode: 'manual', by: { id: 'u', name: 'U' }, created_at: new Date() });
    const { events } = (await get('/api/assets/trep/timeline?scope=key&include=notes')).json();
    expect(events.find((e: { id: string }) => e.id === 'note:1')).toMatchObject({ via: 'user', user: { tag: 'Important' } });
    const plain = (await get('/api/assets/trep/timeline?scope=key')).json();
    expect(plain.events.some((e: { id: string }) => e.id === 'note:1')).toBe(false);
  });
});

describe('branches', () => {
  it('lists branches trunk first, without internals', async () => {
    const out = (await get('/api/assets/trep/branches')).json();
    expect(out.map((b: { id: string }) => b.id)).toEqual(['PAH', 'PH-ILD']);
    expect(out[1]).toMatchObject({ from: 'PAH', color: '#0b7a6f', status: 'Approved · US' });
    expect(out[0]).not.toHaveProperty('members');
    expect(out[0]).not.toHaveProperty('aliases');
  });

  it('is empty for an asset without branches', async () => {
    await db.collection('assets').insertOne({ _id: 'solo' as never, name: 'Solo', kind: 'primary', status: 'ready', company: { name: 'X' }, tags: {} });
    expect((await get('/api/assets/solo/branches')).json()).toEqual([]);
  });
});

describe('event detail', () => {
  it('resolves an id with slashes, its records, neighbours and branch position', async () => {
    const res = await get(`/api/assets/trep/events/${encodeURIComponent(AI_ID)}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.event).toMatchObject({ id: AI_ID, via: 'ai_events' });
    expect(body.records).toEqual([
      expect.objectContaining({ collection: 'company_records', key: 'pr:1', tab: 'company-ir', title: 'UT announces' }),
      expect.objectContaining({ collection: 'articles', key: 'https://news/x', tab: 'news' }),
    ]);
    expect(body.neighbors.prev).toMatchObject({ id: 'rule:start:b' });
    expect(body.neighbors.next).toBeNull();
    expect(body.branchStats).toMatchObject({ index: 2, total: 2, prevSameBranch: { id: 'rule:start:b' } });
  });

  it('404s for an unknown event', async () => {
    expect((await get('/api/assets/trep/events/nope')).statusCode).toBe(404);
  });

  it('resolves a real-length (~250 char) url-bearing id and returns records in the list shape', async () => {
    await db.collection('assets').insertOne({ _id: 'long' as never, name: 'Long', kind: 'primary', status: 'ready', company: { name: 'X' }, tags: {} });
    const longId = `ai:long:https://www.example.com/news/2024/${'very-long-path-segment/'.repeat(8)}story?id=1&x=2:0`;
    expect(longId.length).toBeGreaterThan(200);
    await db.collection('journey_events').insertOne({ _id: longId as never, asset: 'long', origin: 'ai', date: '2024-01-01', title: 'Long', category: 'clinical', significance: 'High', is_milestone: false, key: true, sources: [{ collection: 'trial_records', record_key: 'trial:1' }] });
    await db.collection('trial_records').insertOne({ record_key: 'trial:1', record_type: 'trial', title: 'INCREASE', date: '2017-02-03', start_date: '2017-02-03', overall_status: 'COMPLETED', phases: ['PHASE3'], study: { big: 'payload' }, assets: ['long'] });
    const res = await get(`/api/assets/long/events/${encodeURIComponent(longId)}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.event.id).toBe(longId);
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({ collection: 'trial_records', key: 'trial:1', tab: 'clinical', title: 'INCREASE', start_date: '2017-02-03', overall_status: 'COMPLETED', phases: ['PHASE3'] });
    expect(body.records[0]).not.toHaveProperty('study');
    expect(body.records[0]).not.toHaveProperty('_id');
  });

  it('gives a note its neighbours and branch position', async () => {
    const body = (await get(`/api/assets/trep/events/${encodeURIComponent('note:1')}`)).json();
    expect(body.neighbors.prev).toMatchObject({ id: 'rule:approval:a' });
    expect(body.neighbors.next).toMatchObject({ id: 'rule:start:b' });
    expect(body.branchStats).toMatchObject({ index: 2, total: 2, prevSameBranch: { id: 'rule:approval:a' } });
  });
});
