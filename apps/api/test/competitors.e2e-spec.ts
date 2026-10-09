import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Db } from 'mongodb';
import { MONGO_DB } from '../src/database/database.module.js';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

// Stub of the crawl service: records calls; `down` drops connections.
let down = false;
const calls: { path: string; body: any }[] = [];
let stub: Server;
let ctx: TestContext;
let cookies: Record<string, string>;
let db: Db;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  stub = createServer(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    calls.push({ path: req.url!, body });
    if (down) return req.socket.destroy();
    res.setHeader('content-type', 'application/json');
    if (req.url === '/resolve') return res.end(JSON.stringify({ id: 'sotatercept', name: 'Sotatercept', exists: false }));
    res.statusCode = 201;
    res.end(JSON.stringify({ id: 'job-1', asset: body.asset_id, type: body.type, status: 'queued', steps: [] }));
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  ctx = await createTestApp({ CRAWLER_API_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}` });
  cookies = cookiesOf(
    await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN.email, password: ADMIN.password } }),
  );
  db = ctx.app.get<Db>(MONGO_DB);

  await db.collection('assets').insertMany([
    {
      _id: 'trep' as any, name: 'Treprostinil', aliases: [], company: { name: 'United Therapeutics' }, kind: 'primary', status: 'ready',
      tags: { indications: ['PAH', 'PH-ILD'], investigational_indications: ['IPF'], mechanism: 'Prostacyclin analogue' },
      competitor_scan: { at: new Date(), candidates: 24 },
      competitors: [
        { id: 'selexipag', name: 'Selexipag', company: 'J&J', reason: 'Oral IP agonist in PAH', basis: 'both', stage: 'approved',
          coverage: { PAH: 'approved', 'PH-ILD': 'none', IPF: 'none' }, other_indications: [] },
        { id: 'sotatercept', name: 'Sotatercept', company: 'Merck', reason: 'Disease-modifying PAH biologic', basis: 'indication', stage: 'approved',
          coverage: { PAH: 'approved', 'PH-ILD': 'investigational' }, other_indications: ['CTEPH'] },
      ],
    },
    { _id: 'selexipag' as any, name: 'Selexipag', aliases: ['Uptravi'], company: { name: 'Johnson & Johnson' }, kind: 'competitor', status: 'ready',
      tags: { indications: ['PAH'], mechanism: 'IP receptor agonist', modality: 'Small molecule' }, competitor_of: ['trep'] },
    { _id: 'sotatercept' as any, name: 'Sotatercept', aliases: [], company: { name: 'Merck' }, kind: 'competitor', status: 'onboarding',
      tags: { indications: ['PAH'] }, competitor_of: ['trep'] },
  ]);
  await db.collection('journey_events').insertMany([
    { _id: 'r1' as any, asset: 'trep', origin: 'rule', type: 'approval', region: 'US', date: '2002-05-21', is_milestone: false, significance: 'High', category: 'regulatory', title: 'FDA approves Remodulin', sources: [] },
    { _id: 's1' as any, asset: 'selexipag', origin: 'rule', type: 'approval', region: 'US', date: '2015-12-21', is_milestone: false, significance: 'High', category: 'regulatory', title: 'FDA approves Uptravi', sources: [{ collection: 'fda_records', record_key: 'fda:s1' }] },
    { _id: 's2' as any, asset: 'selexipag', origin: 'rule', type: 'approval', region: 'EU', date: '2016-05-12', is_milestone: false, significance: 'High', category: 'regulatory', title: 'EU authorisation', sources: [] },
    { _id: 's3' as any, asset: 'selexipag', origin: 'ai', type: 'trial_readout', date: daysFromNow(-30), is_milestone: false, significance: 'Medium', category: 'clinical', title: 'Phase 3 data', sources: [{ collection: 'articles', record_key: 'https://n/1' }] },
    { _id: 's6' as any, asset: 'selexipag', origin: 'rule', type: 'trial_stopped', date: daysFromNow(400), is_milestone: false, significance: 'Medium', category: 'clinical', title: 'Withdrawn before its planned completion', sources: [] },
    { _id: 's4' as any, asset: 'selexipag', origin: 'rule', type: 'expected_readout', date: daysFromNow(100), is_milestone: true, significance: 'High', category: 'clinical', title: 'Readout expected', sources: [] },
    { _id: 's5' as any, asset: 'selexipag', origin: 'rule', type: 'expected_readout', date: daysFromNow(2000), is_milestone: true, significance: 'High', category: 'clinical', title: 'Too far out', sources: [] },
  ]);
  await db.collection('trial_records').insertMany([
    { record_key: 'ctgov:A', assets: ['selexipag', 'trep'], overall_status: 'RECRUITING', phases: ['PHASE3'], date: daysFromNow(-10) },
    { record_key: 'ctgov:B', assets: ['selexipag'], overall_status: 'COMPLETED', phases: ['PHASE2'], date: '2015-01-01' },
  ]);
  await db.collection('articles').insertOne({ url: 'https://n/1', assets: ['selexipag'], date: daysFromNow(-30) });
  await db.collection('conference_records').insertOne({ record_key: 'conf:1', record_type: 'conference_abstract', assets: ['trep'], date: '2024-05-01' });
  await db.collection('crawl_ledger').insertMany([
    { _id: 'l1' as any, asset: 'trep', item_key: 'https://n/2', title: 'Tyvaso sales up', collection: 'articles', decision: 'ingest', category: 'financials', reason: 'Revenue', date: '2026-01-02' },
    { _id: 'l2' as any, asset: 'trep', item_key: 'https://n/3', title: 'Market report spam', collection: 'articles', decision: 'skip', category: 'market_report', reason: 'Ad', date: '2026-01-01' },
    { _id: 'l3' as any, asset: 'trep', item_key: 'pubmed:1', title: 'Review of PAH', collection: 'publication_records', decision: 'headline', category: 'publication', reason: 'Review', date: '2025-06-01' },
    { _id: 'l4' as any, asset: 'other', item_key: 'x', title: 'Other asset', collection: 'articles', decision: 'ingest', category: 'deal', reason: '', date: '2026-01-01' },
  ]);
});
afterAll(async () => {
  await closeTestApp(ctx);
  stub.close();
});
beforeEach(() => {
  down = false;
  calls.length = 0;
});

const req = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) => ctx.app.inject({ method, url, cookies, payload });

describe('competitors view', () => {
  it('returns the landscape, evidence, signals and milestones in one payload', async () => {
    const res = await req('GET', '/api/assets/trep/competitors');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reference).toMatchObject({ id: 'trep', indications: ['PAH', 'PH-ILD', 'IPF'] });
    expect(body.kpis).toMatchObject({ tracked: 2, candidates: 24, collecting: 1, activePhase3: 1, upcomingMilestones: 1 });
    expect(body.landscape.map((r: any) => r.id)).toEqual(['trep', 'selexipag', 'sotatercept']);
    expect(body.landscape[0]).toMatchObject({ isReference: true, coverage: { PAH: 'approved', 'PH-ILD': 'approved', IPF: 'investigational' }, firstApproval: '2002-05-21' });
    expect(body.landscape[1]).toMatchObject({
      name: 'Selexipag', company: 'Johnson & Johnson', mechanism: 'IP receptor agonist', reason: 'Oral IP agonist in PAH',
      overlap: { shared: 1, of: 3 }, firstApproval: '2015-12-21', approvalRegions: ['EU', 'US'], activeTrials: 1, activePhase3: 1,
    });
    // Missing coverage entries count as "none".
    expect(body.landscape[2]).toMatchObject({ status: 'onboarding', coverage: { IPF: 'none' }, overlap: { shared: 2, of: 3 }, otherIndications: ['CTEPH'] });
    const selexipag = body.evidence.find((e: any) => e.id === 'selexipag');
    expect(selexipag).toMatchObject({ trials: { total: 2, recent: 1 }, news: { total: 1, recent: 1 } });
    expect(body.evidence.find((e: any) => e.id === 'trep')).toMatchObject({ trials: { total: 1 }, news: { total: 1, recent: 0 } });
    expect(body.signals.map((s: any) => s.id)).toEqual(['s3']);
    expect(body.milestones).toEqual([expect.objectContaining({ id: 's4', assetId: 'selexipag', assetName: 'Selexipag', company: 'Johnson & Johnson' })]);
  });

  it('works for an asset whose competitors are not identified yet', async () => {
    const body = (await req('GET', '/api/assets/selexipag/competitors')).json();
    expect(body.kpis.tracked).toBe(0);
    expect(body.landscape).toHaveLength(1);
  });
});

describe('signals', () => {
  it('lists the latest high-significance moves and the next milestones across assets', async () => {
    const body = (await req('GET', '/api/signals')).json();
    expect(body.recent.map((e: any) => e.id)).toEqual(['s2', 's1', 'r1']);
    expect(body.recent[0]).toMatchObject({ assetId: 'selexipag', assetName: 'Selexipag', kind: 'competitor' });
    expect(body.upcoming.map((e: any) => e.id)).toEqual(['s4', 's5']);
  });
});

describe('evidence', () => {
  it('counts sources and triage decisions for the asset only', async () => {
    const body = (await req('GET', '/api/assets/trep/evidence')).json();
    expect(body.sources.find((s: any) => s.key === 'trials')).toMatchObject({ total: 1, recent: 1 });
    expect(body.sources.find((s: any) => s.key === 'conferences')).toMatchObject({ total: 1, recent: 0 });
    expect(body.triage).toMatchObject({ total: 3, ingest: 1, headline: 1, skip: 1 });
    expect(body.triage.byCategory).toHaveLength(3);
  });

  it('pages and filters the triage ledger', async () => {
    const all = (await req('GET', '/api/assets/trep/ledger')).json();
    expect(all.total).toBe(3);
    expect(all.items[0]).toMatchObject({ id: 'l1', decision: 'ingest', recordKey: 'https://n/2', collection: 'articles' });
    expect((await req('GET', '/api/assets/trep/ledger?decision=skip')).json().items.map((i: any) => i.id)).toEqual(['l2']);
    expect((await req('GET', '/api/assets/trep/ledger?collection=publication_records')).json().total).toBe(1);
    expect((await req('GET', '/api/assets/trep/ledger?q=sales')).json().total).toBe(1);
    expect((await req('GET', '/api/assets/trep/ledger?decision=maybe')).statusCode).toBe(400);
  });
});

describe('adding and removing assets', () => {
  const card = {
    name: 'Sotatercept',
    aliases: ['Winrevair', 'Sotatercept', ' MK-7962 '],
    company: { name: 'Merck', website: 'https://www.merck.com', ir_url: '' },
    tags: { indications: ['PAH'], mechanism: 'Activin signalling inhibitor', modality: 'Biologic' },
  };

  it('proxies resolve to the crawl service', async () => {
    expect((await req('POST', '/api/resolve', { query: 'sotatercept' })).json()).toMatchObject({ id: 'sotatercept' });
    expect(calls[0]).toMatchObject({ path: '/resolve', body: { query: 'sotatercept' } });
  });

  it('creates a new asset, starts its onboarding crawl and posts the job card into the chat', async () => {
    const session = (await req('POST', '/api/chat/sessions', {})).json();
    const res = await req('POST', '/api/assets', { ...card, name: 'Macitentan', chatSessionId: session.id });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ asset: { id: 'macitentan', status: 'onboarding', kind: 'primary' }, job: { id: 'job-1', type: 'onboard' } });
    expect(calls[0]).toMatchObject({ path: '/jobs', body: { asset_id: 'macitentan', type: 'onboard', requested_by: { name: ADMIN.name } } });
    const asset = await db.collection('assets').findOne({ _id: 'macitentan' as any });
    expect(asset).toMatchObject({ aliases: ['Winrevair', 'Sotatercept', 'MK-7962'], company: { name: 'Merck', website: 'https://www.merck.com' } });
    expect(asset!.company.ir_url).toBeUndefined();
    const messages = (await req('GET', `/api/chat/sessions/${session.id}/messages`)).json();
    expect(messages[0].cards[0]).toMatchObject({ type: 'job', jobId: 'job-1', assetId: 'macitentan', assetName: 'Macitentan' });
    // It shows up in the asset list straight away.
    expect((await req('GET', '/api/assets')).json().map((a: any) => a.id)).toContain('macitentan');
  });

  it('promotes a competitor asset to primary instead of duplicating it', async () => {
    const res = await req('POST', '/api/assets', card);
    expect(res.statusCode).toBe(201);
    const asset = await db.collection('assets').findOne({ _id: 'sotatercept' as any });
    expect(asset).toMatchObject({ kind: 'primary', status: 'onboarding', competitor_of: ['trep'] });
  });

  it('refuses an asset that is already tracked', async () => {
    const res = await req('POST', '/api/assets', { ...card, name: 'Trep' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'ASSET_EXISTS' });
    expect(calls).toHaveLength(0);
  });

  it('undoes the asset when the crawl cannot start', async () => {
    down = true;
    expect((await req('POST', '/api/assets', { ...card, name: 'Riociguat' })).statusCode).toBe(503);
    expect(await db.collection('assets').countDocuments({ _id: 'riociguat' as any })).toBe(0);
  });

  it('validates the identity card', async () => {
    const res = await req('POST', '/api/assets', { ...card, company: { name: 'Merck', website: 'not a url' }, extra: 1 });
    expect(res.statusCode).toBe(400);
  });

  it('lets an admin delete an asset and untags its records', async () => {
    expect((await req('DELETE', '/api/assets/selexipag')).statusCode).toBe(204);
    expect(await db.collection('assets').countDocuments({ _id: 'selexipag' as any })).toBe(0);
    expect(await db.collection('journey_events').countDocuments({ asset: 'selexipag' })).toBe(0);
    expect((await db.collection('trial_records').findOne({ record_key: 'ctgov:A' }))!.assets).toEqual(['trep']);
    const trep = await db.collection('assets').findOne({ _id: 'trep' as any });
    expect(trep!.competitors.map((c: any) => c.id)).toEqual(['sotatercept']);
  });
});
