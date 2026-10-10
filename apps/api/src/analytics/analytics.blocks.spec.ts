import { activityByYear, landscape, patentRows, pipeline, significanceMix, stats, trialRows } from './analytics.blocks.js';

const TODAY = '2026-10-09';
const branches = [
  { id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', color: '#2347d9', trunk: true, ended: null },
  { id: 'IPF', label: 'IPF', full: 'Idiopathic pulmonary fibrosis', color: '#6941c6', trunk: false, ended: null },
  { id: 'PH-COPD', label: 'PH-COPD', full: 'PH due to COPD', color: '#b54708', trunk: false, ended: 'Terminated' },
];
const events = [
  { _id: 'a', branch: 'PAH', type: 'approval', category: 'regulatory', date: '2002-05-21', significance: 'High', is_milestone: false },
  { _id: 'b', branch: 'IPF', type: 'trial_start', category: 'clinical', phase: 'PHASE3', date: '2021-06-01', significance: 'High', is_milestone: false },
  { _id: 'c', branch: 'IPF', type: 'regulatory_submission', category: 'regulatory', date: '2026-09-30', significance: 'High', is_milestone: false },
  { _id: 'd', branch: 'IPF', type: 'regulatory_decision_expected', category: 'regulatory', date: '2027-07-30', significance: 'High', is_milestone: true, title: 'FDA decision expected (PDUFA date): Tyvaso' },
  { _id: 'e', branch: 'PH-COPD', type: 'trial_start', category: 'clinical', phase: 'PHASE3', date: '2018-05-08', significance: 'Medium', is_milestone: false },
];

describe('pipeline', () => {
  it('derives the furthest stage per branch and the next milestone', () => {
    const rows = pipeline(branches, events, { tags: {} }, TODAY);
    expect(rows.map((r) => [r.id, r.stage])).toEqual([['PAH', 4], ['IPF', 3], ['PH-COPD', 2]]);
    expect(rows[1].next).toMatchObject({ id: 'd', date: '2027-07-30' });
    expect(rows[2]).toMatchObject({ ended: 'Terminated', since: '2018-05-08' });
  });
  it('falls back to the asset indications without branches', () => {
    const rows = pipeline([], [], { tags: { indications: ['PAH'], investigational_indications: ['IPF'] } }, TODAY);
    expect(rows.map((r) => [r.label, r.stage])).toEqual([['PAH', 4], ['IPF', 0]]);
  });
});

describe('activity, significance, landscape', () => {
  it('stacks events per year by category', () => {
    const out = activityByYear(events);
    expect(out.cols[0]).toBe(2002);
    expect(out.cols.at(-1)).toBe(2027);
    expect(out.series.find((s) => s.k === 'clinical')!.vals.reduce((a, b) => a + b, 0)).toBe(2);
  });
  it('counts significance and handles empty input', () => {
    expect(significanceMix(events)).toEqual({ High: 4, Medium: 1, Low: 0 });
    expect(activityByYear([])).toEqual({ cols: [], series: expect.any(Array) });
  });
  it('builds the competitor × indication matrix', () => {
    const out = landscape({ name: 'Treprostinil', tags: { indications: ['PAH'], investigational_indications: ['IPF'] } }, [
      { id: 'n', name: 'Nintedanib', company: 'BI', coverage: { PAH: 'none', IPF: 'approved' } },
    ]);
    expect(out.cols).toEqual(['PAH', 'IPF']);
    expect(out.rows[0]).toMatchObject({ name: 'Treprostinil', me: true, cells: { PAH: 'approved', IPF: 'investigational' } });
    expect(out.rows[1].cells).toEqual({ PAH: 'none', IPF: 'approved' });
  });
});

describe('trials, patents, stats', () => {
  const trials = trialRows(
    [
      { nct_id: 'NCT1', acronym: 'TETON-1', phases: ['PHASE3'], overall_status: 'RECRUITING', start_date: '2021-06-01', primary_completion_date: '2027-01-01', enrollment: 598, conditions: ['IPF'], lead_sponsor: 'United Therapeutics' },
      { nct_id: 'NCT2', phases: ['PHASE2'], overall_status: 'COMPLETED', start_date: '2010-01-01', enrollment: 40, conditions: ['PAH'], lead_sponsor: 'Some University' },
    ],
    'United Therapeutics',
  );
  it('marks company trials and keeps phase labels', () => {
    expect(trials.map((t) => [t.nct, t.phase, t.company])).toEqual([['NCT1', 'Phase 3', true], ['NCT2', 'Phase 2', false]]);
  });
  it('lists patents with the in-force runway', () => {
    const rows = patentRows([{ publication_number: 'US1', title: 'T', grant_date: '2015-01-27', expiry_date: '2032-04-20', legal_status: 'Active' }, { publication_number: 'US2', grant_date: '', expiry_date: '2030-01-01', legal_status: 'Revoked' }], TODAY);
    expect(rows.map((r) => [r.number, r.invalidated])).toEqual([['US2', true], ['US1', false]]);
    const s = stats({ pipeline: pipeline(branches, events, { tags: {} }, TODAY), trials, events, patents: rows, evidenceRecords: 12 }, TODAY);
    expect(s).toMatchObject({ approvedIndications: 1, inDevelopment: ['IPF'], activeTrials: 1, phase3: 1, patients: 598, evidenceRecords: 12 });
    expect(s.nextCatalyst).toMatchObject({ id: 'd' });
    expect(s.patentRunwayYears).toBeCloseTo(5.5, 0);
  });
  it('measures the runway to the next in-force expiry', () => {
    const rows = patentRows([{ publication_number: 'LATE', expiry_date: '2040-01-01', legal_status: 'Active' }, { publication_number: 'SOON', expiry_date: '2028-01-01', legal_status: 'Active' }], TODAY);
    expect(rows.map((r) => r.number)).toEqual(['SOON', 'LATE']);
    const s = stats({ pipeline: [], trials: [], events: [], patents: rows, evidenceRecords: 0 }, TODAY);
    expect(s.patentRunwayYears).toBeCloseTo(1.2, 1);
  });
  it('returns null stats when nothing is known', () => {
    expect(stats({ pipeline: [], trials: [], events: [], patents: [], evidenceRecords: 0 }, TODAY)).toMatchObject({ nextCatalyst: null, patentRunwayYears: null });
  });
});

describe('bare asset (no trials, patents, competitors)', () => {
  const bare = { name: 'Bare', tags: {} };
  const finite = (v: unknown): boolean => (typeof v === 'number' ? Number.isFinite(v) : v && typeof v === 'object' ? Object.values(v).every(finite) : true);
  it('yields empty blocks and finite stats', () => {
    const pipe = pipeline([], [], bare, TODAY);
    const trials = trialRows([], undefined);
    const patents = patentRows([], TODAY);
    const out = { pipe, trials, patents, activity: activityByYear([]), sig: significanceMix([]), land: landscape(bare, []), st: stats({ pipeline: pipe, trials, events: [], patents, evidenceRecords: 0 }, TODAY) };
    expect(out.pipe).toEqual([]);
    expect(out.land.rows).toHaveLength(1);
    expect(out.st).toEqual({ approvedIndications: 0, inDevelopment: [], activeTrials: 0, phase3: 0, patients: 0, nextCatalyst: null, patentRunwayYears: null, evidenceRecords: 0 });
    expect(finite(out)).toBe(true);
  });
});
