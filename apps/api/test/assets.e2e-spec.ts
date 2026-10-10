import type { Db } from 'mongodb';
import { MONGO_DB } from '../src/database/database.module.js';
import { ValkeyService } from '../src/valkey/valkey.service.js';
import { ADMIN, closeTestApp, cookiesOf, createTestApp, type TestContext } from './helpers/test-app.js';

let ctx: TestContext;
let cookies: Record<string, string>;
let db: Db;

const A = 'trep';
const PR_URL = 'https://ir.example.com/press-releases/2021/04-01-2021';

async function seed() {
  await db.collection('assets').insertMany([
    {
      _id: A as any,
      name: 'Treprostinil',
      aliases: ['Tyvaso'],
      company: { name: 'United Therapeutics' },
      tags: { indications: ['PAH', 'PH-ILD'], mechanism: 'Prostacyclin analogue' },
      kind: 'primary',
      status: 'ready',
      competitors: [],
    },
  ]);
  await db.collection('journey_events').insertMany([
    { _id: 'e1' as any, asset: A, origin: 'rule', date: '2009-07-30', type: 'approval', category: 'regulatory', region: 'US', significance: 'High', is_milestone: false, title: 'FDA approves Tyvaso', sources: [{ collection: 'fda_records', record_key: 'fda:1' }] },
    { _id: 'e2' as any, asset: A, origin: 'rule', date: '2021-03-31', type: 'label_expansion', category: 'regulatory', region: 'US', significance: 'High', is_milestone: false, title: 'PH-ILD approval' },
    { _id: 'e3' as any, asset: A, origin: 'rule', date: '2019-01-01', type: 'trial_start', category: 'clinical', significance: 'Low', is_milestone: false, sponsor_is_company: false, title: 'Investigator study' },
    { _id: 'e4' as any, asset: A, origin: 'rule', date: '2099-09-01', type: 'expected_readout', category: 'clinical', significance: 'High', is_milestone: true, sponsor_is_company: true, title: 'TETON readout', sources: [{ collection: 'trial_records', record_key: 'ctgov:NCT1' }], merged_sources: [{ collection: 'trial_records', record_key: 'ctgov:NCT2' }] },
    // AI-extracted from news: free-text region, so it must not count as an FDA/EMA authorisation.
    { _id: 'e5' as any, asset: A, origin: 'ai', date: '2010-01-01', type: 'approval', category: 'regulatory', region: 'Japan', significance: 'Low', is_milestone: false, title: 'Approved in Japan' },
  ]);
  await db.collection('trial_records').insertMany([
    { record_key: 'ctgov:NCT1', nct_id: 'NCT1', title: 'TETON (phase 3)', phases: ['PHASE3'], overall_status: 'RECRUITING', date: '2025-01-01', lead_sponsor: 'United Therapeutics Corp', conditions: ['PH-ILD', 'PAH'], assets: [A], study: { huge: 'x'.repeat(1000) } },
    { record_key: 'ctgov:NCT2', nct_id: 'NCT2', title: 'INCREASE', phases: ['PHASE2'], overall_status: 'COMPLETED', date: '2017-01-01', lead_sponsor: 'Academic Hospital', conditions: ['PAH'], assets: [A] },
    { record_key: 'ctgov:NCT9', nct_id: 'NCT9', title: 'Other drug', phases: ['PHASE3'], overall_status: 'RECRUITING', date: '2024-01-01', assets: ['other'] },
  ]);
  await db.collection('fda_records').insertMany([
    { record_key: 'fda:1', record_type: 'fda_submission', date: '2009-07-30', brand_names: ['TYVASO'], assets: [A] },
    { record_key: 'fda:faers:2', record_type: 'fda_adverse_events_monthly', date: '2020-02-01', month: '2020-02', report_count: 7, assets: [A] },
    { record_key: 'fda:faers:1', record_type: 'fda_adverse_events_monthly', date: '2020-01-01', month: '2020-01', report_count: 5, assets: [A] },
  ]);
  await db.collection('ema_records').insertMany([
    { record_key: 'ema:1', record_type: 'ema_epar', date: '2020-04-03', name_of_medicine: 'Trepulmix', assets: [A] },
  ]);
  await db.collection('company_records').insertMany([
    { record_key: `uthr:press_release:${PR_URL}`, record_type: 'press_release', date: '2021-04-01', title: 'Tyvaso approved for PH-ILD', mentions: ['Tyvaso'], content: 'Full release text', assets: [A] },
    { record_key: 'uthr:press_release:other', record_type: 'press_release', date: '2021-05-01', title: 'Share buyback', tags: ['Financial'], mentions: [], content: '...', assets: [A] },
    { record_key: 'uthr:pi:1', record_type: 'prescribing_info', date: '2026-10-08', title: 'TYVASO-PI.pdf', mentions: ['Tyvaso'], content: 'Indications...', assets: [A] },
  ]);
  await db.collection('articles').insertOne({ url: 'https://news.example.com/a', title: 'News', date: '2026-10-01', content: 'body', assets: [A] });
  await db.collection('patent_records').insertMany([
    { record_key: 'patent:US1B2', record_type: 'patent', date: '2015-01-01', publication_number: 'US1B2', title: 'Treprostinil formulation', legal_status: 'Active', abstract: 'long', events: [{ type: 'granted' }], assets: [A] },
    { record_key: 'patent:EP2A1', record_type: 'patent', date: '2016-01-01', publication_number: 'EP2A1', title: 'Inhaled dosing', legal_status: 'Withdrawn', abstract: 'long', events: [], assets: [A] },
  ]);
  await db.collection('conference_records').insertOne({
    record_key: 'conference:ats-2025-1', record_type: 'conference_abstract', date: '2025-05-18', conference: 'ATS', title: 'TETON-2 subgroup', abstract: 'long', assets: [A],
  });
}

beforeAll(async () => {
  ctx = await createTestApp();
  db = ctx.app.get<Db>(MONGO_DB);
  await seed();
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN.email, password: ADMIN.password } });
  cookies = cookiesOf(res);
});
afterAll(async () => {
  await closeTestApp(ctx);
});

const get = (url: string) => ctx.app.inject({ method: 'GET', url, cookies });

describe('assets API', () => {
  it('requires a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/assets' });
    expect(res.statusCode).toBe(401);
  });

  it('lists assets with counts and their latest significant event', async () => {
    const res = await get('/api/assets');
    expect(res.statusCode).toBe(200);
    const [asset] = res.json();
    expect(asset).toMatchObject({
      id: A,
      name: 'Treprostinil',
      company: { name: 'United Therapeutics' },
      counts: { trials: 2, regulatory: 2, pressReleases: 2, documents: 1, news: 1, publications: 0, conferences: 1, patents: 2, events: 5 },
      latestEvent: { date: '2021-03-31', title: 'PH-ILD approval' },
    });
  });

  it('returns 404 for unknown assets and tabs', async () => {
    expect((await get('/api/assets/nope')).json()).toMatchObject({ statusCode: 404, code: 'ASSET_NOT_FOUND' });
    expect((await get(`/api/assets/${A}/records/nope`)).json()).toMatchObject({ statusCode: 404, code: 'TAB_NOT_FOUND' });
  });

  it('gives detail KPIs', async () => {
    const res = await get(`/api/assets/${A}`);
    expect(res.json().kpis).toEqual({ approvalRegions: ['US'], activeTrials: 1, activePhase3: 1, upcomingMilestones: 1 });
  });
});

describe('records panel data', () => {
  it('counts facets over the whole tab and the tab total, whatever is filtered', async () => {
    const res = (await get(`/api/assets/${A}/records/clinical?status=COMPLETED`)).json();
    expect(res.total).toBe(1);
    expect(res.all).toBe(2);
    const byKey = Object.fromEntries(res.facets.map((f: { key: string; values: unknown }) => [f.key, f.values]));
    expect(byKey.phases).toEqual([{ value: 'PHASE2', count: 1 }, { value: 'PHASE3', count: 1 }]);
    // List fields count once per record, by their first element (as the column shows it).
    expect(byKey.conditions).toEqual([{ value: 'PAH', count: 1 }, { value: 'PH-ILD', count: 1 }]);
    expect(res.facets.map((f: { label: string }) => f.label)).toEqual(['Phase', 'Status', 'Indication']);
  });

  it('filters by facet selection (array facets match any element) and ignores unknown keys', async () => {
    const ild = (await get(`/api/assets/${A}/records/clinical?facets=${encodeURIComponent('{"conditions":"PH-ILD","nope":"x"}')}`)).json();
    expect(ild.items.map((r: { key: string }) => r.key)).toEqual(['ctgov:NCT1']);
    expect(ild.items[0].__f_conditions).toBeUndefined();
    expect((await get(`/api/assets/${A}/records/clinical?facets=%7Bbad`)).statusCode).toBe(400);
  });

  it('derives region and status facets for regulatory records', async () => {
    const res = (await get(`/api/assets/${A}/records/regulatory?facets=${encodeURIComponent('{"region":"EU"}')}`)).json();
    expect(res.items.map((r: { key: string }) => r.key)).toEqual(['ema:1']);
    expect(res.facets.find((f: { key: string }) => f.key === 'region').values).toEqual([{ value: 'EU', count: 1 }, { value: 'US', count: 1 }]);
  });

  it('counts the congress with its year, and press-release categories from tags', async () => {
    const conf = (await get(`/api/assets/${A}/records/conferences`)).json();
    expect(conf.facets.find((f: { key: string }) => f.key === 'conference').values).toEqual([{ value: 'ATS 2025', count: 1 }]);
    const picked = (await get(`/api/assets/${A}/records/conferences?facets=${encodeURIComponent('{"conference":"ATS 2025"}')}`)).json();
    expect(picked.total).toBe(1);
    const ir = (await get(`/api/assets/${A}/records/company-ir?facets=${encodeURIComponent('{"category":"Financial"}')}`)).json();
    expect(ir.items.map((r: { key: string }) => r.key)).toEqual(['uthr:press_release:other']);
  });

  it('lists the journey events of ledger items too (Evidence tab Journey column)', async () => {
    await db.collection('crawl_ledger').insertMany([
      { _id: 'lg1' as any, asset: A, item_key: 'fda:1', title: 'FDA doc', collection: 'fda_records', decision: 'ingest', category: 'x', reason: 'r', date: '2009-07-30' },
      { _id: 'lg2' as any, asset: A, item_key: 'none', title: 'Other', collection: 'articles', decision: 'skip', category: 'x', reason: 'r', date: '2009-07-29' },
    ]);
    const { items } = (await get(`/api/assets/${A}/ledger`)).json();
    expect(items.find((i: { id: string }) => i.id === 'lg1').journey_events.map((e: { id: string }) => e.id)).toEqual(['e1']);
    expect(items.find((i: { id: string }) => i.id === 'lg2').journey_events).toEqual([]);
  });

  it('keeps only company-sponsored trials when asked', async () => {
    const res = (await get(`/api/assets/${A}/records/clinical?companyOnly=true`)).json();
    expect(res.items.map((r: { key: string }) => r.key)).toEqual(['ctgov:NCT1']);
  });

  it('lists the journey events each record feeds (as a source or a merged source), on lists and on one record', async () => {
    const list = (await get(`/api/assets/${A}/records/clinical`)).json();
    const ev = { id: 'e4', title: 'TETON readout', date: '2099-09-01', category: 'clinical', significance: 'High' };
    expect(list.items.find((r: { key: string }) => r.key === 'ctgov:NCT1').journey_events).toEqual([ev]);
    expect(list.items.find((r: { key: string }) => r.key === 'ctgov:NCT2').journey_events).toEqual([ev]);
    const one = (await get(`/api/assets/${A}/record/regulatory?key=fda:1`)).json();
    expect(one.journey_events.map((e: { id: string }) => e.id)).toEqual(['e1']);
    const none = (await get(`/api/assets/${A}/records/regulatory`)).json();
    expect(none.items.find((r: { key: string }) => r.key === 'ema:1').journey_events).toEqual([]);
  });
});

describe('timeline', () => {
  it('is newest first by default', async () => {
    const { events, total } = (await get(`/api/assets/${A}/timeline`)).json();
    expect(total).toBe(5);
    expect(events.map((e: { id: string }) => e.id)).toEqual(['e4', 'e2', 'e3', 'e5', 'e1']);
  });

  it('filters by significance, milestones and company trials', async () => {
    const high = (await get(`/api/assets/${A}/timeline?significance=High&milestones=exclude`)).json();
    expect(high.events.map((e: { id: string }) => e.id)).toEqual(['e2', 'e1']);
    const upcoming = (await get(`/api/assets/${A}/timeline?milestones=only`)).json();
    expect(upcoming.events.map((e: { id: string }) => e.id)).toEqual(['e4']);
    const company = (await get(`/api/assets/${A}/timeline?companyOnly=true`)).json();
    expect(company.events.map((e: { id: string }) => e.id)).not.toContain('e3');
  });

  it('rejects invalid filters', async () => {
    expect((await get(`/api/assets/${A}/timeline?category=ip`)).statusCode).toBe(200);
    expect((await get(`/api/assets/${A}/timeline?category=gossip`)).statusCode).toBe(400);
    expect((await get(`/api/assets/${A}/timeline?from=yesterday`)).statusCode).toBe(400);
  });
});

describe('records', () => {
  it('pages trials, omitting heavy fields and adding a key', async () => {
    const res = (await get(`/api/assets/${A}/records/clinical?pageSize=1`)).json();
    expect(res).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ key: 'ctgov:NCT1', nct_id: 'NCT1' });
    expect(res.items[0]).not.toHaveProperty('study');
    expect(res.items[0]).not.toHaveProperty('_id');
    const page2 = (await get(`/api/assets/${A}/records/clinical?pageSize=1&page=2`)).json();
    expect(page2.items[0].key).toBe('ctgov:NCT2');
  });

  it('filters by phase and searches case-insensitively, safely', async () => {
    expect((await get(`/api/assets/${A}/records/clinical?phase=PHASE2`)).json().items.map((t: any) => t.nct_id)).toEqual(['NCT2']);
    expect((await get(`/api/assets/${A}/records/clinical?q=teton`)).json().total).toBe(1);
    // Regex metacharacters typed in a search box must not break the query.
    const res = await get(`/api/assets/${A}/records/clinical?q=${encodeURIComponent('(phase 3')}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it('merges FDA and EMA records by date and leaves out adverse-event counts', async () => {
    const res = (await get(`/api/assets/${A}/records/regulatory`)).json();
    expect(res.items.map((r: { key: string }) => r.key)).toEqual(['ema:1', 'fda:1']);
  });

  it('serves FDA calendar events and CHMP opinions as regulatory records, without their heavy fields', async () => {
    const calendar = { record_key: 'fda_calendar:uid1', record_type: 'fda_calendar_event', date: '2022-05-23', title: 'PDUFA date: Tyvaso DPI', evidence: [{ text: 'long' }], assets: [A] };
    const chmp = [
      { record_key: 'ema:chmp:m1:positive:trepulmix', record_type: 'ema_chmp_opinion', date: '2020-01-30', title: 'CHMP recommends approval of Trepulmix (treprostinil sodium)', name_of_medicine: 'Trepulmix', status: 'Pending EC decision', content: 'Medicine card and paragraphs', assets: [A] },
      { record_key: 'ema:chmp:m0:highlights', record_type: 'ema_chmp_highlight', date: '2008-05-29', title: 'CHMP meeting highlights (May 2008)', content: 'Narrative', assets: [A] },
    ];
    await db.collection('fda_records').insertOne(calendar);
    await db.collection('ema_records').insertMany(chmp);
    try {
      const byType = (await get(`/api/assets/${A}/records/regulatory?type=fda_calendar_event,ema_chmp_opinion,ema_chmp_highlight`)).json();
      expect(byType.items.map((r: { key: string }) => r.key)).toEqual(['fda_calendar:uid1', 'ema:chmp:m1:positive:trepulmix', 'ema:chmp:m0:highlights']);
      expect(byType.items[0]).not.toHaveProperty('evidence');
      expect(byType.items[1]).toMatchObject({ status: 'Pending EC decision' });
      expect(byType.items[1]).not.toHaveProperty('content');
      // Titles are searchable (the calendar event has no medicine name).
      expect((await get(`/api/assets/${A}/records/regulatory?q=pdufa`)).json().items.map((r: { key: string }) => r.key)).toEqual(['fda_calendar:uid1']);
      const full = await get(`/api/assets/${A}/record/regulatory?key=${encodeURIComponent('ema:chmp:m1:positive:trepulmix')}`);
      expect(full.json()).toMatchObject({ content: 'Medicine card and paragraphs' });
    } finally {
      await db.collection('fda_records').deleteOne({ record_key: calendar.record_key });
      await db.collection('ema_records').deleteMany({ record_key: { $in: chmp.map((r) => r.record_key) } });
    }
  });

  it('serves patents (status = legal status) and conference abstracts from the team crawlers', async () => {
    const patents = (await get(`/api/assets/${A}/records/patents`)).json();
    expect(patents.items.map((r: { key: string }) => r.key)).toEqual(['patent:EP2A1', 'patent:US1B2']);
    expect(patents.items[0]).not.toHaveProperty('abstract');
    expect(patents.items[0]).not.toHaveProperty('events');
    expect((await get(`/api/assets/${A}/records/patents?status=Active`)).json().items.map((r: { key: string }) => r.key)).toEqual(['patent:US1B2']);
    expect((await get(`/api/assets/${A}/records/patents?q=us1`)).json().total).toBe(1);
    const abstracts = (await get(`/api/assets/${A}/records/conferences?q=ats`)).json();
    expect(abstracts.items).toEqual([expect.objectContaining({ key: 'conference:ats-2025-1', title: 'TETON-2 subgroup' })]);
    expect(abstracts.items[0]).not.toHaveProperty('abstract');
  });

  it('can limit company releases to those mentioning the asset', async () => {
    const all = (await get(`/api/assets/${A}/records/company-ir`)).json();
    const mentions = (await get(`/api/assets/${A}/records/company-ir?mentionsOnly=true`)).json();
    expect(all.total).toBe(2);
    expect(mentions.items.map((r: { title: string }) => r.title)).toEqual(['Tyvaso approved for PH-ILD']);
    expect(all.items[0]).not.toHaveProperty('content');
  });

  it('returns one full record by key, including URL-shaped keys', async () => {
    const key = encodeURIComponent(`uthr:press_release:${PR_URL}`);
    const res = await get(`/api/assets/${A}/record/company-ir?key=${key}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Tyvaso approved for PH-ILD', content: 'Full release text' });
    expect((await get(`/api/assets/${A}/record/company-ir?key=missing`)).statusCode).toBe(404);
    // A record of another tab isn't reachable through this one.
    expect((await get(`/api/assets/${A}/record/company-ir?key=uthr:pi:1`)).statusCode).toBe(404);
  });

  it('serves the adverse-event series in month order', async () => {
    expect((await get(`/api/assets/${A}/series/adverse-events`)).json()).toEqual([
      { month: '2020-01', count: 5 },
      { month: '2020-02', count: 7 },
    ]);
  });
});

describe('caching', () => {
  it('serves cached views until the asset version is bumped', async () => {
    const before = (await get('/api/assets')).json();
    await db.collection('assets').insertOne({
      _id: 'aaa-new' as any, name: 'Aaa New', aliases: [], company: { name: 'X' }, tags: {}, kind: 'primary', status: 'onboarding', competitors: [],
    });
    expect((await get('/api/assets')).json()).toEqual(before);

    const valkey = ctx.app.get(ValkeyService);
    await valkey.client.incr(valkey.key('assets', 'ver'));
    const after = (await get('/api/assets')).json();
    expect(after.map((a: { id: string }) => a.id)).toEqual(['aaa-new', A]);
  });
});

describe('v3 lifecycle', () => {
  const V3_COLLECTIONS = ['asset_branches', 'event_stars', 'event_comments', 'journey_notes', 'analytics_pins', 'asset_analytics', 'crawl_feedback'];

  it('removes v3 data with the asset', async () => {
    await db.collection('assets').insertOne({ _id: 'gone' as any, name: 'Gone', kind: 'primary', status: 'ready', company: { name: 'X' }, tags: {} });
    for (const coll of V3_COLLECTIONS) await db.collection(coll).insertOne({ asset: 'gone' });
    await db.collection('web_records').insertOne({ key: 'w1', assets: ['gone', 'other'] });
    await db.collection('record_chunks').insertMany([
      { _id: 'web_records|w1|0' as any, collection: 'web_records', record_key: 'w1', assets: ['gone', 'other'] },
      { _id: 'web_records|w2|0' as any, collection: 'web_records', record_key: 'w2', assets: ['gone'] },
    ]);
    const res = await ctx.app.inject({ method: 'DELETE', url: '/api/assets/gone', cookies });
    expect(res.statusCode).toBe(204);
    for (const coll of V3_COLLECTIONS) {
      expect(await db.collection(coll).countDocuments({ asset: 'gone' })).toBe(0);
    }
    expect((await db.collection('web_records').findOne({ key: 'w1' }))!.assets).toEqual(['other']);
    expect((await db.collection('record_chunks').find({ collection: 'web_records' }).toArray()).map((c) => c.record_key)).toEqual(['w1']);
  });
});
