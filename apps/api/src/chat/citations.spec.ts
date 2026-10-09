import { CitationRegistry } from './citations.js';

const src = (recordKey: string, collection = 'trial_records', recordType?: string) => ({
  assetId: 'trep', assetName: 'Treprostinil', collection, recordKey, title: recordKey, date: '2024-01-01', url: null, recordType,
});

describe('CitationRegistry', () => {
  it('numbers each record once and knows its tab', () => {
    const r = new CitationRegistry();
    expect(r.ref(src('ctgov:1'))).toBe(1);
    expect(r.ref(src('pubmed:1', 'publication_records'))).toBe(2);
    expect(r.ref(src('ctgov:1'))).toBe(1);
    expect(r.ref(src('x', 'unknown_collection'))).toBeNull();
    r.ref(src('pi', 'company_records', 'prescribing_info'));
    r.ref(src('pr', 'company_records', 'press_release'));
    const { citations } = r.finalize('PI [3] and release [4].');
    expect(citations.map((c) => c.tab)).toEqual(['documents', 'company-ir']);
  });

  it('renumbers cited refs in reading order and drops made-up ones', () => {
    const r = new CitationRegistry();
    for (const k of ['a', 'b', 'c', 'd']) r.ref(src(k));
    const { text, citations } = r.finalize('First [4][2]. Then [2, 3]. Bogus [9]. Done.');
    expect(text).toBe('First [1][2]. Then [2, 3]. Bogus. Done.');
    expect(citations.map((c) => [c.n, c.recordKey])).toEqual([[1, 'd'], [2, 'b'], [3, 'c']]);
  });
});
