import type { Db } from 'mongodb';
import { MONGO_DB } from '../src/database/database.module.js';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

let ctx: TestContext;
let cookies: Record<string, string>;
let db: Db;
const call = (method: 'GET' | 'PUT', url: string, payload?: object) => ctx.app.inject({ method, url, cookies, payload });

beforeAll(async () => {
  ctx = await createTestApp();
  cookies = cookiesOf(await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN.email, password: ADMIN.password } }));
  db = ctx.app.get<Db>(MONGO_DB);
  await db.collection('assets').insertMany([
    { _id: 'trep' as never, name: 'Treprostinil', kind: 'primary', status: 'ready', company: { name: 'United Therapeutics' }, tags: { indications: ['PAH'], investigational_indications: ['IPF'] }, competitors: [{ id: 'nint', name: 'Nintedanib', company: 'BI', coverage: { PAH: 'none', IPF: 'approved' } }] },
    { _id: 'bare' as never, name: 'Bare', kind: 'primary', status: 'ready', company: { name: 'X' }, tags: {} },
  ]);
  await db.collection('journey_events').insertMany([
    { _id: 'a' as never, asset: 'trep', origin: 'rule', branch: 'PAH', type: 'approval', category: 'regulatory', date: '2002-05-21', significance: 'High', is_milestone: false, key: true },
    { _id: 'b' as never, asset: 'trep', origin: 'ai', branch: 'PAH', type: 'trial_readout', category: 'clinical', date: '2020-02-24', significance: 'High', is_milestone: false, key: true },
  ]);
  await db.collection('asset_branches').insertOne({ _id: 'trep:PAH' as never, asset: 'trep', id: 'PAH', label: 'PAH', full: 'PAH', color: '#2347d9', trunk: true, ended: null, start: '2002-05-21' });
  await db.collection('trial_records').insertMany([
    { record_key: 'ctgov:NCT1', nct_id: 'NCT1', assets: ['trep'], phases: ['PHASE3'], overall_status: 'RECRUITING', start_date: '2021-06-01', date: '2021-06-01', enrollment: 598, conditions: ['IPF'], lead_sponsor: 'United Therapeutics' },
    { record_key: 'ctgov:NCT2', nct_id: 'NCT2', assets: ['trep'], phases: ['PHASE2'], overall_status: 'COMPLETED', start_date: '2010-01-01', date: '2010-01-01', enrollment: 40, conditions: ['PAH'], lead_sponsor: 'A University' },
  ]);
  await db.collection('patent_records').insertOne({ record_key: 'patent:US1', assets: ['trep'], country: 'US', kind: 'B2', publication_number: 'US1', grant_date: '2015-01-27', expiry_date: '2032-04-20', legal_status: 'Active', date: '2015-01-27' });
  await db.collection('crawl_ledger').insertMany([
    { asset: 'trep', decision: 'ingest' }, { asset: 'trep', decision: 'headline' }, { asset: 'trep', decision: 'skip' },
  ]);
});
afterAll(() => closeTestApp(ctx));

describe('analytics', () => {
  it('returns every block for a rich asset', async () => {
    const out = (await call('GET', '/api/assets/trep/analytics')).json();
    expect(Object.keys(out).sort()).toEqual(['activityByYear', 'landscape', 'patents', 'pipeline', 'recordsByYear', 'significance', 'sourceMix', 'stats', 'triageFunnel', 'trials'].sort());
    expect(out.pipeline[0]).toMatchObject({ id: 'PAH', stage: 4 });
    expect(out.trials).toHaveLength(2);
    expect(out.sourceMix).toEqual(expect.arrayContaining([{ coll: 'trial_records', n: 2 }, { coll: 'patent_records', n: 1 }]));
    expect(out.recordsByYear).toEqual(expect.arrayContaining([{ coll: 'trial_records', year: 2021, n: 1 }]));
    expect(out.triageFunnel).toEqual({ screened: 3, relevant: 2, ingested: 1, candidates: 1, journey: 1 });
    expect(out.landscape.rows.map((r: { name: string }) => r.name)).toEqual(['Treprostinil', 'Nintedanib']);
    expect(out.stats).toMatchObject({ activeTrials: 1, phase3: 1, patients: 598, evidenceRecords: 3 });
  });

  it('degrades gracefully for an asset with no data', async () => {
    const res = await call('GET', '/api/assets/bare/analytics');
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.pipeline).toEqual([]);
    expect(out.trials).toEqual([]);
    expect(out.stats).toMatchObject({ nextCatalyst: null, patentRunwayYears: null, evidenceRecords: 0 });
  });
});

describe('tab insights', () => {
  it('counts by year and facet, with company vs investigator per year for trials', async () => {
    const out = (await call('GET', '/api/assets/trep/records/clinical/insights')).json();
    expect(out).toMatchObject({ tab: 'clinical', total: 2 });
    expect(out.byYear).toEqual(expect.arrayContaining([{ year: 2021, n: 1 }, { year: 2010, n: 1 }]));
    expect(out.facets.phases).toEqual(expect.arrayContaining([{ value: 'PHASE3', n: 1 }]));
    expect(out.byYearGroup).toEqual(expect.arrayContaining([{ year: 2021, group: 'company', n: 1 }, { year: 2010, group: 'other', n: 1 }]));
  });
  it('404s for an unknown tab', async () => {
    expect((await call('GET', '/api/assets/trep/records/nope/insights')).statusCode).toBe(404);
    expect((await call('GET', '/api/assets/trep/records/constructor/insights')).statusCode).toBe(404);
    expect((await call('GET', '/api/assets/trep/records/toString')).statusCode).toBe(404);
  });
});

describe('pins', () => {
  it('are null until saved, then per user', async () => {
    expect((await call('GET', '/api/assets/trep/analytics/pins')).json()).toEqual({ items: null });
    const items = [{ key: 'pipeline' }, { custom: { id: 'c1', title: 'Phase 3 to approval', chart: 'bars', method: 'index', sources: ['fda:1'], refreshed_at: '2026-10-09' } }];
    expect((await call('PUT', '/api/assets/trep/analytics/pins', { items })).json()).toEqual({ items });
    expect((await call('GET', '/api/assets/trep/analytics/pins')).json()).toEqual({ items });
  });
  it('rejects malformed pins and custom specs without sources', async () => {
    expect((await call('PUT', '/api/assets/trep/analytics/pins', { items: [{}] })).statusCode).toBe(400);
    expect((await call('PUT', '/api/assets/trep/analytics/pins', { items: [{ custom: { id: 'x', title: 'X', chart: 'bars', method: 'index', sources: [] } }] })).statusCode).toBe(400);
    expect((await call('PUT', '/api/assets/trep/analytics/pins', { items: Array.from({ length: 25 }, () => ({ key: 'a' })) })).statusCode).toBe(400);
  });
});
