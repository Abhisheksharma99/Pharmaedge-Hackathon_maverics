import type { Db } from 'mongodb';
import { MONGO_DB } from '../src/database/database.module.js';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

let ctx: TestContext;
let cookies: Record<string, string>;
const get = (url: string) => ctx.app.inject({ method: 'GET', url, cookies });

beforeAll(async () => {
  ctx = await createTestApp();
  cookies = cookiesOf(await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN.email, password: ADMIN.password } }));
  const db = ctx.app.get<Db>(MONGO_DB);
  await db.collection('assets').insertMany([
    { _id: 'trep' as never, name: 'Treprostinil', aliases: ['Tyvaso'], kind: 'primary', status: 'onboarding', company: { name: 'United Therapeutics' }, tags: {} },
    { _id: 'nint' as never, name: 'Nintedanib', aliases: ['Ofev'], kind: 'competitor', status: 'ready', company: { name: 'BI' }, tags: {}, competitor_of: ['trep'] },
  ]);
  await db.collection('jobs').insertOne({ _id: 'j' as never, asset: 'trep', type: 'onboard', status: 'running', steps: [{ status: 'done' }, { status: 'done' }, { status: 'running' }, { status: 'pending' }], created_at: new Date() });
  await db.collection('journey_events').insertMany([
    { _id: 'e1' as never, asset: 'trep', origin: 'rule', title: 'Phase 3 trial started: TETON-1', nct_id: 'NCT04708782', date: '2021-06-01', category: 'clinical', key: true },
    { _id: 'e2' as never, asset: 'nint', origin: 'ai', title: 'Ofev approved for PPF', date: '2020-03-09', category: 'regulatory', key: true },
    { _id: 'e3' as never, asset: 'trep', origin: 'rule', title: 'Label update for TETON', date: '2022-01-01', category: 'regulatory', key: false },
  ]);
});
afterAll(() => closeTestApp(ctx));

describe('portfolio timeline', () => {
  it('shows primary assets with live progress and their key events', async () => {
    const out = (await get('/api/portfolio/timeline?from=2015-01-01&to=2030-01-01')).json();
    expect(out.assets).toEqual([expect.objectContaining({ id: 'trep', kind: 'primary', status: 'onboarding', progress: 0.5, company: 'United Therapeutics' })]);
    expect(out.events.map((e: { id: string }) => e.id)).toEqual(['e1']);
  });
  it('adds competitors on request', async () => {
    const out = (await get('/api/portfolio/timeline?competitors=true')).json();
    expect(out.assets.map((a: { id: string }) => a.id).sort()).toEqual(['nint', 'trep']);
    expect(out.assets.find((a: { id: string }) => a.id === 'nint')).toMatchObject({ competitorOf: ['trep'], progress: null });
    expect(out.events.map((e: { id: string }) => e.id).sort()).toEqual(['e1', 'e2']);
  });
});

describe('search', () => {
  it('finds assets by alias and events by title or NCT id, key events first', async () => {
    const out = (await get('/api/search?q=teton')).json();
    expect(out.events.map((e: { id: string }) => e.id)).toEqual(['e1', 'e3']);
    expect(out.events[0]).toMatchObject({ assetName: 'Treprostinil' });
    expect((await get('/api/search?q=NCT04708782')).json().events.map((e: { id: string }) => e.id)).toEqual(['e1']);
    expect((await get('/api/search?q=ofev')).json().assets.map((a: { id: string }) => a.id)).toEqual(['nint']);
  });
  it('skips events for one-character queries and rejects empty ones', async () => {
    expect((await get('/api/search?q=t')).json().events).toEqual([]);
    expect((await get('/api/search?q=')).statusCode).toBe(400);
  });
});
