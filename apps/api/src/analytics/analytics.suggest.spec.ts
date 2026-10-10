import { suggest, type SuggestInput } from './analytics.suggest.js';

const base = (o: Partial<SuggestInput> = {}): SuggestInput => ({ asset: { tags: {}, company: { name: 'Co' }, competitors: [] }, branches: [], events: [], trials: [], competitorMilestones: [], secFiler: false, ...o });
const ids = (i: SuggestInput) => suggest(i).map((s) => s.id);
const ev = (type: string, branch: string, key: string, extra = {}) => ({ type, branch, sources: [{ collection: 'fda_records', record_key: key }], ...extra });
const trial = (cond: string, key: string) => ({ record_key: key, phases: ['PHASE3'], start_date: '2010-01-01', conditions: [cond] });
const branches = [{ id: 'PAH', label: 'PAH', trunk: true }, { id: 'ILD', label: 'PH-ILD' }];

describe('suggest', () => {
  it('suggests nothing for an empty asset', () => expect(suggest(base())).toEqual([]));

  it('tta needs >=2 programmes with a pivotal start and a decision', () => {
    const events = [ev('approval', 'PAH', 'f1'), ev('label_expansion', 'ILD', 'f2')];
    const out = suggest(base({ branches, events, trials: [trial('PAH', 't1'), trial('PH-ILD', 't2')] }));
    expect(out[0]).toMatchObject({ id: 'tta', src: 'index', records: 4 });
    expect(out[0]!.records).toBe(out[0]!.sources!.length);
    expect(out[0]!.sources).toEqual(['t1', 't2', 'f1', 'f2']);
    expect(ids(base({ branches, events, trials: [trial('PAH', 't1')] }))).not.toContain('tta');
    expect(ids(base({ branches, events: [events[0]!], trials: [trial('PAH', 't1'), trial('PH-ILD', 't2')] }))).not.toContain('tta');
  });

  it('tta ignores blank conditions and dedupes records shared across programmes', () => {
    const events = [ev('approval', 'PAH', 'f1'), ev('approval', 'ILD', 'f2')];
    expect(ids(base({ branches, events, trials: [trial('', 't1'), trial('  ', 't2')] }))).not.toContain('tta');
    const shared = { ...trial('PAH', 't1'), conditions: ['PAH', 'PH-ILD'] };
    const out = suggest(base({ branches, events, trials: [shared] }))[0]!;
    expect(out.records).toBe(3);
    expect(out.sources).toEqual(['t1', 'f1', 'f2']);
  });

  it('label needs >=3 supplements', () => {
    const e = (k: string) => ev('label_expansion', 'PAH', k);
    expect(suggest(base({ events: [e('a'), e('b'), e('c')] }))[0]).toMatchObject({ id: 'label', records: 3, sources: ['a', 'b', 'c'], why: 'Label changes on 1 product are already on the journey' });
    expect(suggest(base({ events: [e('a'), ev('new_formulation', 'ILD', 'b'), ev('label_expansion', 'X', 'c')] }))[0]!.why).toBe('Label changes across 3 products are already on the journey');
    expect(ids(base({ events: [e('a'), e('b'), { type: 'label_expansion', branch: 'PAH' }] }))).not.toContain('label');
    expect(ids(base({ events: [e('a'), e('b')] }))).not.toContain('label');
  });

  it('cal needs dated competitor milestones', () => {
    const m = [{ assetName: 'Ofev', sources: [{ record_key: 'k' }] }];
    expect(suggest(base({ competitorMilestones: m }))[0]).toMatchObject({ id: 'cal', records: 1, why: "Ofev's journey has upcoming dates", sources: ['k'] });
    const mk = (n: string, k: string) => ({ assetName: n, sources: [{ record_key: k }] });
    expect(suggest(base({ competitorMilestones: [mk('A', '1'), mk('B', '2'), mk('B', '2')] }))[0]).toMatchObject({ why: 'A and B journeys have upcoming dates', records: 2 });
    expect(suggest(base({ competitorMilestones: [mk('A', '1'), mk('B', '2'), mk('C', '3'), mk('D', '4')] }))[0]!.why).toBe('A, B and 2 more journeys have upcoming dates');
    expect(ids(base({ competitorMilestones: [{ assetName: 'A' }] }))).not.toContain('cal');
    expect(ids(base())).not.toContain('cal');
  });

  it('marketed product drives faers; rev also needs an SEC filer; share needs a competitor', () => {
    const marketed = { tags: { indications: ['PAH'] }, company: { name: 'Co' }, competitors: [{ name: 'Rival' }] };
    expect(ids(base({ asset: marketed }))).toEqual(['faers', 'share']);
    expect(suggest(base({ asset: marketed, secFiler: true })).map((s) => [s.id, s.src])).toEqual([['rev', 'web'], ['faers', 'web'], ['share', 'limited']]);
    expect(ids(base({ secFiler: true }))).toEqual([]);
    expect(ids(base({ asset: { ...marketed, competitors: [] } }))).toEqual(['faers']);
  });
});
