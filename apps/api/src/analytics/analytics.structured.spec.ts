import { isStructured, structuredSpec } from './analytics.structured.js';
import type { SuggestInput } from './analytics.suggest.js';

const base = (o: Partial<SuggestInput> = {}): SuggestInput => ({ asset: { tags: {}, company: { name: 'Co' }, competitors: [] }, branches: [], events: [], trials: [], competitorMilestones: [], secFiler: false, ...o });
const src = (key: string) => [{ collection: 'fda_records', record_key: key }];
const ev = (type: string, branch: string, key: string, date: string, extra = {}) => ({ type, branch, date, sources: src(key), ...extra });
const trial = (cond: string, key: string, start: string, nct?: string) => ({ record_key: key, nct_id: nct, phases: ['PHASE3'], start_date: start, conditions: [cond] });
const branches = [{ id: 'PAH', label: 'PAH', trunk: true }, { id: 'ILD', label: 'PH-ILD' }];
const TODAY = '2026-10-10';
const AT = '2026-10-10T00:00:00.000Z';
const tta = (i: SuggestInput) => structuredSpec('tta', i, 'ai-1', TODAY, AT);
const label = (i: SuggestInput) => structuredSpec('label', i, 'ai-1', TODAY, AT);
const rowsOf = (spec: { data?: unknown }) => (spec.data ?? []) as { l: string; v: number; sub: string; d: string }[];
const cal = (i: SuggestInput) => structuredSpec('cal', i, 'ai-1', TODAY, AT);

describe('isStructured', () => {
  it('is true only for tta, label and cal', () => {
    expect(['tta', 'label', 'cal'].every((s) => isStructured(s as never))).toBe(true);
    expect(['rev', 'faers', 'share', undefined].some((s) => isStructured(s as never))).toBe(false);
  });
});

describe('tta', () => {
  it('computes years from the earliest Phase 3 start to the approval, sorted longest first, with only the keys used', () => {
    const spec = tta(base({
      branches,
      trials: [trial('PAH', 't-late', '2008-01-01'), trial('PAH', 't-early', '2005-01-01', 'NCT1'), trial('PH-ILD', 't2', '2016-07-01')],
      events: [ev('approval', 'PAH', 'f1', '2009-01-01'), ev('approval', 'ILD', 'f2', '2021-04-01')],
    }));
    expect(spec).toMatchObject({ chart: 'hbar', unit: ' yrs', method: 'index', refreshed_at: AT });
    expect(spec.data).toEqual([
      { l: 'PAH (NCT1)', v: 4, c: expect.any(String) },
      { l: 'PH-ILD', v: 4.8, c: expect.any(String) },
    ].sort((a, b) => b.v - a.v));
    expect(spec.sources).toEqual(['t2', 'f2', 't-early', 'f1']);
    expect(spec.sources).not.toContain('t-late');
    expect(spec.note).not.toMatch(/without an approval/);
  });

  it('uses the approval over an earlier-listed, earlier-dated supplement', () => {
    const spec = tta(base({
      branches,
      trials: [trial('PAH', 't1', '2005-01-01'), trial('PH-ILD', 't2', '2010-01-01')],
      events: [ev('label_expansion', 'PAH', 'sup', '2006-01-01'), ev('approval', 'PAH', 'appr', '2009-01-01'), ev('approval', 'ILD', 'f2', '2015-01-01')],
    }));
    expect(rowsOf(spec).map((d) => d.l)).toEqual(['PH-ILD', 'PAH']);
    expect(rowsOf(spec).find((d) => d.l === 'PAH')!.v).toBe(4);
    expect(spec.sources).toContain('appr');
    expect(spec.sources).not.toContain('sup');
  });

  it('falls back to the first supplement when there is no approval, and says so in the note', () => {
    const spec = tta(base({
      branches,
      trials: [trial('PAH', 't1', '2005-01-01'), trial('PH-ILD', 't2', '2010-01-01')],
      events: [ev('approval', 'PAH', 'a1', '2009-01-01'), ev('new_formulation', 'ILD', 'nf', '2013-01-01')],
    }));
    expect(rowsOf(spec).map((d) => d.l)).toEqual(['PAH', 'PH-ILD · new formulation']);
    expect(spec.note).toMatch(/Programmes without an approval record use their first label change or new formulation/);
  });

  it('ignores decisions that come before the trial start', () => {
    const input = base({
      branches,
      trials: [trial('PAH', 't1', '2010-01-01'), trial('PH-ILD', 't2', '2010-01-01')],
      events: [ev('approval', 'PAH', 'a1', '2005-01-01'), ev('approval', 'ILD', 'a2', '2014-01-01')],
    });
    // PAH has only a pre-trial decision, so only one programme remains.
    expect(tta(input)).toMatchObject({ method: 'none', chart: 'none', sources: [] });
    const withLater = base({ ...input, events: [...input.events, ev('label_expansion', 'PAH', 'late', '2012-01-01')] });
    const spec = tta(withLater);
    expect(spec.sources).toContain('late');
    expect(spec.sources).not.toContain('a1');
  });

  it('gives method none with a note when fewer than two programmes qualify', () => {
    const spec = tta(base({ branches, trials: [trial('PAH', 't1', '2005-01-01')], events: [ev('approval', 'PAH', 'a1', '2009-01-01')] }));
    expect(spec).toMatchObject({ id: 'ai-1', chart: 'none', method: 'none', sources: [], refreshed_at: AT });
    expect(spec.note).toMatch(/Fewer than two programmes/);
    expect(tta(base()).method).toBe('none');
  });
});

describe('label', () => {
  const sup = (type: string, key: string, date: string, extra = {}) => ev(type, 'PAH', key, date, extra);

  it('counts per year per indication and gap-fills missing years with zeros', () => {
    const spec = label(base({
      branches,
      events: [sup('label_expansion', 'k1', '2018-03-01', { indications: ['PAH'] }), sup('label_expansion', 'k2', '2018-09-01', { indications: ['PAH'] }), sup('new_formulation', 'k3', '2021-01-01', { indications: ['ILD'] })],
    }));
    expect(spec).toMatchObject({ chart: 'stack', method: 'index', cols: [2018, 2019, 2020, 2021] });
    expect(spec.series).toEqual([
      expect.objectContaining({ l: 'PAH', k: 'pah', vals: [2, 0, 0, 0] }),
      expect.objectContaining({ l: 'ILD', k: 'ild', vals: [0, 0, 0, 1] }),
    ]);
    expect(spec.sources).toEqual(['k1', 'k2', 'k3']);
    expect(spec.note).toMatch(/^3 label changes/);
  });

  it('shows the top 5 series and folds the rest into Other (only when it hides more than one)', () => {
    const mk = (n: number, count: number) => Array.from({ length: count }, (_, i) => sup('label_expansion', `s${n}-${i}`, '2020-01-01', { indications: [`Ind${n}`] }));
    // Seven series with distinct counts 7..1.
    const events = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => mk(n, 8 - n));
    const spec = label(base({ branches, events }));
    expect(spec.series!.map((s) => s.l)).toEqual(['Ind1', 'Ind2', 'Ind3', 'Ind4', 'Ind5', 'Other']);
    expect(spec.series!.at(-1)!.vals).toEqual([3]); // Ind6 (2) + Ind7 (1)
  });

  it('keeps all six series when only one would fold into Other', () => {
    const events = [1, 2, 3, 4, 5, 6].map((n) => sup('label_expansion', `k${n}`, '2020-01-01', { indications: [`Ind${n}`] }));
    const spec = label(base({ branches, events }));
    expect(spec.series).toHaveLength(6);
    expect(spec.series!.map((s) => s.l)).not.toContain('Other');
  });

  it('falls back to the branch label, then the product, then Unspecified', () => {
    const events = [
      sup('label_expansion', 'a', '2020-01-01'),
      { type: 'label_expansion', branch: 'ILD', date: '2020-06-01', sources: src('b') },
      { type: 'new_formulation', branch: 'ZZ', product: 'Yutrepia', date: '2020-07-01', sources: src('c') },
      { type: 'new_formulation', branch: 'ZZ', date: '2020-08-01', sources: src('d') },
    ];
    const spec = label(base({ branches, events }));
    expect(spec.series!.map((s) => s.l).sort()).toEqual(['PAH', 'PH-ILD', 'Unspecified', 'Yutrepia']);
  });

  it('excludes milestones, sourceless, undated and non-supplement events; sources are only the kept ones', () => {
    const spec = label(base({
      branches,
      events: [
        sup('label_expansion', 'ok1', '2019-01-01'), sup('new_formulation', 'ok2', '2019-05-01'),
        sup('label_expansion', 'ms', '2019-02-01', { is_milestone: true }),
        { type: 'label_expansion', branch: 'PAH', date: '2019-03-01', sources: [] },
        sup('label_expansion', 'nodate', ''), sup('approval', 'appr', '2019-04-01'),
      ],
    }));
    expect(spec.sources).toEqual(['ok1', 'ok2']);
    expect(spec.cols).toEqual([2019]);
  });

  it('gives method none with fewer than two dated label changes', () => {
    const spec = label(base({ branches, events: [sup('label_expansion', 'k1', '2019-01-01')] }));
    expect(spec).toMatchObject({ method: 'none', chart: 'none', sources: [] });
    expect(spec.note).toMatch(/Fewer than two dated label changes/);
  });
});

describe('cal', () => {
  const m = (title: string, date: string, key: string | null, extra = {}) => ({ asset: 'c1', assetName: 'Liquidia', title, date, sources: key ? src(key) : [], ...extra });

  it('sorts soonest first, excludes past and sourceless milestones, with a countdown', () => {
    const spec = cal(base({
      competitorMilestones: [
        m('PDUFA', '2027-01-10', 'k-pdufa'), m('Readout', '2026-10-15', 'k-read'), m('Old', '2026-09-01', 'k-old'),
        m('No source', '2026-11-01', null), m('Today', TODAY, 'k-today'), m('Far', '2029-10-10', 'k-far'),
      ],
    }));
    expect(spec).toMatchObject({ chart: 'list', method: 'index' });
    expect(spec.data).toEqual([
      { l: 'Today', sub: 'Liquidia · now', d: TODAY },
      { l: 'Readout', sub: 'Liquidia · in 5 days', d: '2026-10-15' },
      { l: 'PDUFA', sub: 'Liquidia · in 3 months', d: '2027-01-10' },
      { l: 'Far', sub: 'Liquidia · in 3 years', d: '2029-10-10' },
    ]);
    expect(spec.sources).toEqual(['k-today', 'k-read', 'k-pdufa', 'k-far']);
    expect(spec.note).toBe('Soonest 4 dated milestones across the competitors’ journeys.');
  });

  it('caps at 12 and lists only the sources of the rows shown', () => {
    const milestones = Array.from({ length: 15 }, (_, i) => m(`M${i}`, `2027-${String((i % 12) + 1).padStart(2, '0')}-${String(10 + i).padStart(2, '0')}`, `k${i}`));
    const spec = cal(base({ competitorMilestones: milestones }));
    expect(spec.data).toHaveLength(12);
    expect(spec.sources).toHaveLength(12);
    const dates = rowsOf(spec).map((d) => d.d!);
    expect([...dates].sort()).toEqual(dates);
    const shown = new Set(rowsOf(spec).map((d) => d.l));
    expect(spec.sources!.every((k) => shown.has(`M${k.slice(1)}`))).toBe(true);
  });

  it('falls back to the asset id when the name is unknown, and is none with fewer than two usable', () => {
    const spec = cal(base({ competitorMilestones: [m('A', '2027-01-01', 'a', { assetName: undefined }), m('B', '2027-02-01', 'b', { assetName: undefined })] }));
    expect(rowsOf(spec)[0]!.sub).toMatch(/^c1 · /);
    const none = cal(base({ competitorMilestones: [m('A', '2027-01-01', 'a'), m('Past', '2020-01-01', 'p'), m('Untitled', '2027-02-01', 'u', { title: '' })] }));
    expect(none).toMatchObject({ method: 'none', chart: 'none', sources: [] });
    expect(none.note).toMatch(/Fewer than two dated upcoming competitor milestones/);
  });
});
