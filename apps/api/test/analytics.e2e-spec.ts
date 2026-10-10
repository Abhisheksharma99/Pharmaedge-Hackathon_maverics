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
    expect(out.stats).toMatchObject({ nextCatalyst: null, evidenceRecords: 0 });
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

describe('tab insights per tab', () => {
  beforeAll(async () => {
    await db.collection('assets').insertOne({ _id: 'insx' as never, name: 'Insx', kind: 'primary', status: 'ready', company: { name: 'Acme' }, tags: {} });
    await db.collection('fda_records').insertMany([
      { record_key: 'f1', record_type: 'fda_submission', assets: ['insx'], date: '2020-01-01', name_of_medicine: 'Brandx', submission_status: 'Approved' },
      { record_key: 'f2', record_type: 'fda_submission', assets: ['insx'], date: '2020-06-01', brand_names: ['Brandy'], submission_status: 'Approved' },
    ]);
    await db.collection('ema_records').insertOne({ record_key: 'e1', record_type: 'ema_epar', assets: ['insx'], date: '2021-03-01', name_of_medicine: 'Brandx', submission_status: 'Authorised' });
    await db.collection('conference_records').insertMany([
      { record_key: 'c1', assets: ['insx'], conference: 'ATS', session_type: 'Poster', date: '2023-05-01' },
      { record_key: 'c2', assets: ['insx'], conference: 'ERS', session_type: 'Oral', date: '2023-09-01' },
    ]);
    await db.collection('company_records').insertMany([
      { record_key: 'p1', record_type: 'press_release', assets: ['insx'], date: '2022-01-01', tags: ['Regulatory'] },
      { record_key: 'd1', record_type: 'annual_report', assets: ['insx'], date: '2022-02-01', title: 'Annual 2021', page_count: 140 },
      { record_key: 'd2', record_type: 'company_page', assets: ['insx'], date: '2022-03-01', title: 'Pipeline page' },
    ]);
    await db.collection('patent_records').insertMany([
      { record_key: 'pt1', assets: ['insx'], publication_number: 'US9', title: 'T9', grant_date: '2015-01-27', expiry_date: '2032-04-20', legal_status: 'Active', assignees: ['Acme'], date: '2015-01-27' },
      { record_key: 'pt2', assets: ['insx'], publication_number: 'US8', title: 'T8', legal_status: 'Pending', date: '2016-01-01' },
    ]);
    await db.collection('crawl_ledger').insertMany([
      { asset: 'insx', decision: 'ingest', source: 'a.com' }, { asset: 'insx', decision: 'ingest', source: 'a.com' },
      { asset: 'insx', decision: 'headline', source: 'b.com' }, { asset: 'insx', decision: 'skip', source: 'a.com' },
    ]);
    await db.collection('journey_events').insertOne({ _id: 'insx-e' as never, asset: 'insx', origin: 'ai', key: true, type: 'x', category: 'company', date: '2022-01-01', significance: 'Low', is_milestone: false });
  });
  const get = async (tab: string) => (await call('GET', `/api/assets/insx/records/${tab}/insights`)).json();

  it('regulatory: US/EU per year and product counts across FDA brand names and EMA medicines', async () => {
    const out = await get('regulatory');
    expect(out.byYearGroup).toEqual(expect.arrayContaining([{ year: 2020, group: 'US', n: 2 }, { year: 2021, group: 'EU', n: 1 }]));
    expect(out.facets.product).toEqual(expect.arrayContaining([{ value: 'Brandx', n: 2 }, { value: 'Brandy', n: 1 }]));
  });
  it('conferences: per congress and year', async () => {
    const out = await get('conferences');
    expect(out.byYearGroup).toEqual(expect.arrayContaining([{ year: 2023, group: 'ATS', n: 1 }, { year: 2023, group: 'ERS', n: 1 }]));
    expect(out.facets.session_type).toEqual(expect.arrayContaining([{ value: 'Poster', n: 1 }]));
  });
  it('company-ir: press releases per year and first tag', async () => {
    expect((await get('company-ir')).byYearGroup).toEqual([{ year: 2022, group: 'Regulatory', n: 1 }]);
  });
  it('documents: types and the longest documents by pages', async () => {
    const out = await get('documents');
    expect(out.facets.record_type).toEqual(expect.arrayContaining([{ value: 'annual_report', n: 1 }]));
    expect(out.top).toEqual([{ title: 'Annual 2021', pages: 140 }]);
  });
  it('patents: terms with grant, expiry and status', async () => {
    const out = await get('patents');
    expect(out.terms).toEqual([{ number: 'US9', title: 'T9', granted: '2015-01-27', expiry: '2032-04-20', status: 'Active', assignee: 'Acme' }]);
    expect(out.facets.legal_status).toEqual(expect.arrayContaining([{ value: 'Pending', n: 1 }]));
  });
  it('evidence: triage funnel, decisions and top sources from the ledger', async () => {
    const out = await get('evidence');
    expect(out).toMatchObject({ tab: 'evidence', total: 4, triage: { screened: 4, relevant: 3, ingested: 2, journey: 1 } });
    expect(out.facets.decision).toEqual([{ value: 'ingest', n: 2 }, { value: 'headline', n: 1 }, { value: 'skip', n: 1 }]);
    expect(out.facets.source).toEqual([{ value: 'a.com', n: 3 }, { value: 'b.com', n: 1 }]);
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

describe('analytics suggestions', () => {
  beforeAll(async () => {
    await db.collection('journey_events').insertMany([
      { _id: 'n-past' as never, asset: 'nint', is_milestone: true, date: '2000-01-01', sources: [{ collection: 'fda_records', record_key: 'past' }] },
      { _id: 'n-next' as never, asset: 'nint', is_milestone: true, date: '2999-01-01', sources: [{ collection: 'fda_records', record_key: 'next' }] },
    ]);
  });

  it('requires auth and a known asset', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/assets/trep/analytics/suggestions' })).statusCode).toBe(401);
    expect((await call('GET', '/api/assets/nope/analytics/suggestions')).statusCode).toBe(404);
  });

  it('returns the heuristic rows with sources, and nothing for a bare asset', async () => {
    const out = (await call('GET', '/api/assets/trep/analytics/suggestions')).json();
    expect(out.map((s: { id: string }) => s.id)).toEqual(['cal', 'faers', 'share']);
    expect(out[0]).toMatchObject({ records: 1, sources: ['next'], why: "Nintedanib's journey has upcoming dates" });
    expect(out[1]).toMatchObject({ title: expect.any(String), why: expect.any(String), src: 'web', records: 0, sources: ['open.fda.gov · drug/event API'] });
    expect((await call('GET', '/api/assets/bare/analytics/suggestions')).json()).toEqual([]);
  });

  it('every analytics block is present for an asset with no trials, patents or competitors', async () => {
    const out = (await call('GET', '/api/assets/bare/analytics')).json();
    expect(Object.keys(out).sort()).toEqual(['activityByYear', 'landscape', 'patents', 'pipeline', 'recordsByYear', 'significance', 'sourceMix', 'stats', 'triageFunnel', 'trials']);
    expect(out).toMatchObject({ patents: [], recordsByYear: [], sourceMix: [], activityByYear: { cols: [] }, significance: { High: 0, Medium: 0, Low: 0 }, triageFunnel: { screened: 0, relevant: 0, ingested: 0, candidates: 0, journey: 0 } });
    expect(out.landscape.rows).toHaveLength(1);
    expect(out.stats).toEqual({ approvedIndications: 0, approved: [], inDevelopment: [], activeTrials: 0, phase3: 0, patients: 0, nextCatalyst: null, evidenceRecords: 0 });
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'number' && !Number.isFinite(v)) bad.push(path);
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
    };
    walk(out, 'blocks');
    expect(bad).toEqual([]);
  });
});
