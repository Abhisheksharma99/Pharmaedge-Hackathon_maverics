import { mentionedAssets } from './chat.service.js';
import { nameKey } from './chat-tools.js';
import { assess, diversify, identifiersIn, rrf, type EvidenceHit } from './evidence-search.js';
import { measure } from './market.js';
import { validate, type Schema } from './tool-schema.js';
import { pieces, valuesIn, verifyAnswer } from './verify.js';

const hit = (key: string, over: Partial<EvidenceHit> = {}): EvidenceHit => ({
  collection: 'articles', record_key: key, chunk: 0, text: '', title: key, date: '2024-01-01', url: null,
  record_type: null, assets: ['a'], score: 0, via: ['vector'], ...over,
});

describe('tool argument validation', () => {
  const schema: Schema = {
    type: 'object', additionalProperties: false, required: ['asset_id'],
    properties: {
      asset_id: { type: 'string', pattern: '^[a-z0-9-]{1,80}$' },
      limit: { type: 'integer', minimum: 1, maximum: 40 },
      category: { type: 'array', maxItems: 2, items: { type: 'string', enum: ['regulatory', 'clinical'] } },
      from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    },
  };

  it('accepts valid arguments', () => {
    expect(validate({ asset_id: 'trep', limit: 5, category: ['clinical'], from: '2024-01-01' }, schema)).toEqual([]);
  });

  it('rejects instead of coercing', () => {
    const errs = validate({ asset_id: 'Trep; drop', limit: '5', category: ['clinical', 'x', 'y'], from: 'yesterday', extra: 1 }, schema);
    expect(errs).toEqual(expect.arrayContaining([
      'arguments.asset_id has an invalid format', 'arguments.limit must be an integer', 'arguments.category allows at most 2 items',
      'arguments.category[1] must be one of regulatory, clinical', 'arguments.from has an invalid format', 'arguments.extra is not allowed',
    ]));
    expect(validate({}, schema)).toEqual(['arguments.asset_id is required']);
    expect(validate({ asset_id: null }, schema)).toEqual(['arguments.asset_id is required']); // null does not satisfy required
    expect(validate({ asset_id: 'a', limit: 41 }, schema)).toEqual(['arguments.limit must be ≤ 40']);
    expect(validate({ asset_id: { $ne: null } }, schema)).toEqual(['arguments.asset_id must be a string']); // operator injection
  });
});

describe('evidence retrieval helpers', () => {
  it('finds record identifiers, not ordinary words', () => {
    expect(identifiersIn('Status of NCT04708782 and patent US11793780B2 under NDA 214275?')).toEqual(['NCT04708782', 'US11793780B2', 'NDA214275']);
    expect(identifiersIn('What did BMS-986278 show in phase 3?')).toEqual(['BMS-986278']);
    expect(identifiersIn('How did TETON-2 go in IPF in 2024?')).toEqual([]);
  });

  it('fuses ranked lists with weights (reciprocal rank fusion)', () => {
    const fused = rrf([
      { name: 'vector', weight: 0.2, items: [{ _id: 'x' }, { _id: 'y' }] },
      { name: 'text', weight: 0.8, items: [{ _id: 'y' }, { _id: 'z' }] },
    ]);
    expect(fused.map((f) => f.item._id)).toEqual(['y', 'z', 'x']);
    expect(fused[0]!.via).toEqual(['vector', 'text']);
  });

  it('keeps two passages per record and one copy of a syndicated headline', () => {
    const hits = [
      hit('r1', { chunk: 0 }), hit('r1', { chunk: 1 }), hit('r1', { chunk: 2 }),
      hit('wire-a', { title: 'FDA Grants X Breakthrough', date: '2022-02-24' }), hit('wire-b', { title: 'FDA grants X breakthrough!', date: '2022-02-24T10:00' }),
      hit('r2'),
    ];
    expect(diversify(hits, 10).map((h) => `${h.record_key}:${h.chunk}`)).toEqual(['r1:0', 'r1:1', 'wire-a:0', 'r2:0']);
  });

  it('judges evidence insufficient only on deterministic grounds', () => {
    expect(assess([], [])).toMatchObject({ sufficient: false });
    expect(assess([hit('t', { text: 'Trial NCT04708782 met its endpoint' })], ['NCT04708782'])).toMatchObject({ sufficient: true });
    // a similar-looking trial is not evidence about the one asked for; every identifier asked about must be found
    expect(assess([hit('t', { text: 'Trial NCT04708781' })], ['NCT04708782'])).toMatchObject({ sufficient: false, reason: 'no passage mentions NCT04708782' });
    expect(assess([hit('t', { text: 'NCT1 and more' })], ['NCT1', 'NCT2'])).toMatchObject({ sufficient: false });
    expect(assess([hit('t', { text: 'anything' })], [])).toMatchObject({ sufficient: true });
  });
});

describe('answer verification', () => {
  const evidence: Record<number, string> = {
    1: '{"title":"HYPERION met its primary endpoint","date":"2025-06-23","text":"reduced the risk of clinical worsening by 76%; 1,228 patients"}',
    2: '{"date":"2024-03-22","title":"FDA approves OPSYNVI"}',
  };
  const ev = (n: number) => evidence[n] ?? '';

  it('extracts dates, percentages and numbers', () => {
    expect(valuesIn('Approved on 22 Mar 2024 [2], 76% fewer events in 1,228 patients (Phase 3, 2 trials).')).toEqual(['2024-03-22', '76%', '1228']);
    expect(valuesIn('In June 2025 it met the endpoint.')).toEqual(['2025-06']);
  });

  it('keeps supported values, marks unsupported and uncited ones', () => {
    const { text, issues } = verifyAnswer('HYPERION cut worsening by 76% in 1,228 patients [1]. OPSYNVI was approved on 22 Mar 2024 [2]. It cut events by 81% [1]. Sales were $2.1 billion.', ev, 'PE-canary');
    expect(text).toBe('HYPERION cut worsening by 76% in 1,228 patients [1]. OPSYNVI was approved on 22 Mar 2024 [2]. It cut events by 81% [1]. (unverified) Sales were $2.1 billion. (no source)');
    expect(issues).toEqual([{ kind: 'unsupported_value', detail: '81%' }, { kind: 'uncited_value', detail: '2.1' }]);
  });

  it('does not split a sentence at "U.S." (the citation stays with its date)', () => {
    expect(pieces('On 22 Mar 2024 the U.S. FDA approved it [2]. Next.')).toEqual(['On 22 Mar 2024 the U.S. FDA approved it [2].', ' ', 'Next.']);
    expect(verifyAnswer('On 22 Mar 2024 the U.S. FDA approved it [2].', ev, 'x').issues).toEqual([]);
  });

  it('reads a citation after the full stop, and one closing a paragraph, the way the model writes them', () => {
    expect(pieces('It cut events by 76%. [1] Next one.')).toEqual(['It cut events by 76%. [1]', ' ', 'Next one.']);
    // sentence 1 has no citation of its own: the paragraph's closing [1] covers it; the next paragraph's [2] does not
    const two = 'The TDE-PH-304 substudy enrolled 1,228 patients. Risk fell by 76%. [1]\nIt enrolled 500 more.\n\nApproved 22 Mar 2024. [2]';
    const { text, issues } = verifyAnswer(two, ev, 'x');
    expect(issues).toEqual([{ kind: 'uncited_value', detail: '500' }]);
    expect(text).toBe(two.replace('500 more.', '500 more. (no source)'));
    expect(verifyAnswer('**Status: completed on 23 Jun 2026.** It enrolled 1,228. [1]', ev, 'x').issues).toEqual([{ kind: 'unsupported_value', detail: '2026-06-23' }]);
  });

  it('a value cited to a ref the model was never given is unsupported', () => {
    expect(verifyAnswer('It was approved in 2019 [7].', ev, 'x').issues).toEqual([{ kind: 'unsupported_value', detail: '2019' }]);
  });

  it('redacts secrets, connection strings, paths and the prompt canary', () => {
    const { text, issues } = verifyAnswer(
      'The key is sk-abcdefghijklmnopqrstuv. DB at mongodb://app:pw@mongo:27017/x. Files in /Users/someone/project. My rules mention PE-1234abcd. Fine sentence.',
      ev, 'PE-1234abcd');
    expect(text).toBe('[removed]  [removed]  [removed]  [removed]  Fine sentence.');
    expect(issues.map((i) => i.detail)).toEqual(['api key', 'connection string', 'filesystem path', 'system prompt']);
  });
});

describe('market reaction (port of patent_intel/market/impact.py)', () => {
  const bars = [
    { date: '2024-01-04', close: 100 }, { date: '2024-01-05', close: 110 }, { date: '2024-01-08', close: 90 },
    ...Array.from({ length: 25 }, (_, i) => ({ date: `2024-02-${String(i + 1).padStart(2, '0')}`, close: 120 })),
  ];

  it('measures from the first trading day on/after the event against the prior close', () => {
    const { impact } = measure(bars, '2024-01-06', '2026-10-10'); // Saturday -> Monday 2024-01-08
    expect(impact).toMatchObject({ trading_day: '2024-01-08', base_close: 110, day0: -18.18, dip: -18.18, peak: 9.09 });
    expect(impact!.day5).toBe(9.09);
    expect(impact!.day20).toBe(9.09);
  });

  it('explains what cannot be measured', () => {
    expect(measure(bars, '2023-12-01', '2026-10-10').note).toBe('before price history');
    expect(measure(bars, '2027-01-01', '2026-10-10').note).toBe('upcoming');
    expect(measure([], '2024-01-05', '2026-10-10').note).toBe('no price history');
  });
});

describe('deterministic alias resolution', () => {
  const assets = [
    { _id: 'sotatercept', name: 'Sotatercept', aliases: ['Winrevair'], master: { names: ['MK-7962', 'ACE-011', 'ACE'] } },
    { _id: 'trep', name: 'Treprostinil', aliases: [] },
  ];

  it('finds assets by name, alias or drug-master name - whole words only', () => {
    expect(mentionedAssets('Any news on MK-7962 and treprostinil?', assets)).toEqual([
      { id: 'sotatercept', name: 'Sotatercept', as: 'MK-7962' }, { id: 'trep', name: 'Treprostinil', as: 'Treprostinil' },
    ]);
    expect(mentionedAssets('Is MK-79620 or pre-treprostinil-x an ACE inhibitor?', assets)).toEqual([]); // partial codes, 3-letter names
    expect(mentionedAssets('What about C++ (and [x]?', [{ _id: 'c', name: 'C++ (and', aliases: [] }])).toHaveLength(1); // names are escaped
  });

  it('uses the same lookup key as the crawler drug master', () => {
    expect(['BI 1015550', 'BI-1015550', 'bi1015550'].map(nameKey)).toEqual(['bi1015550', 'bi1015550', 'bi1015550']);
  });
});
