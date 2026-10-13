import { eventIndications, indicationMatchers, recordIndications, shortIndication, textIndications } from './record-indications.js';

const BRANCHES = [
  { id: 'PAH', full: 'Pulmonary arterial hypertension', aliases: ['pah', 'pulmonary arterial hypertension', 'idiopathic pah'] },
  { id: 'CLI', full: 'Critical limb ischemia', aliases: ['cli', 'critical limb ischemia'] },
  { id: 'MS', full: 'Multiple sclerosis', aliases: ['ms', 'multiple sclerosis (ms)'] },
];
const matchers = indicationMatchers(BRANCHES, ['Pulmonary arterial hypertension (PAH)', 'Idiopathic pulmonary fibrosis (IPF)', 'Progressive pulmonary fibrosis', 'posterior', 'or panuveitis']);

describe('record indications', () => {
  it('shortens like the web', () => {
    expect(shortIndication('Pulmonary arterial hypertension (PAH)')).toBe('PAH');
    expect(shortIndication('Progressive pulmonary fibrosis')).toBe('Progressive pulmonary fibrosis');
  });

  it('builds matchers from branches, then tags no branch covers (skipping list fragments)', () => {
    expect(matchers.map((m) => m.label)).toEqual(['PAH', 'CLI', 'MS', 'IPF', 'Progressive pulmonary fibrosis']);
  });

  it('matches whole words: names case-insensitively, ids of 3+ letters case-sensitively, two-letter ids never', () => {
    const t = (s: string) => textIndications([s], matchers);
    expect(t('Treprostinil in pulmonary ARTERIAL hypertension')).toEqual(['PAH']);
    expect(t('Outcomes in PAH and CLI')).toEqual(['PAH', 'CLI']);
    expect(t('a clinical study of the pah gene')).toEqual([]);
    expect(t('LC-MS/MS assay')).toEqual([]);
    expect(t('Relapsing multiple sclerosis')).toEqual(['MS']);
    expect(t('IPF cohort; progressive pulmonary fibrosis')).toEqual(['IPF', 'Progressive pulmonary fibrosis']);
    expect(t('posterior segment or panuveitis')).toEqual([]);
  });

  it('takes the first text field that names an indication (title before abstract), arrays included', () => {
    expect(textIndications(['A PAH study', 'also CLI'], matchers)).toEqual(['PAH']);
    expect(textIndications(['Pharmacokinetics', ['Critical limb ischemia']], matchers)).toEqual(['CLI']);
    expect(textIndications([undefined, null, 3], matchers)).toEqual([]);
  });

  it('reads an event by its branch and span, else its indications as labels', () => {
    expect(eventIndications({ branch: 'PAH', span: ['CLI', 'PAH'] }, matchers)).toEqual(['PAH', 'CLI']);
    expect(eventIndications({ indications: ['Pulmonary arterial hypertension', 'Lupus nephritis (LN)'] }, matchers)).toEqual(['PAH', 'LN']);
  });

  it('prefers the journey, falls back to the text, else none', () => {
    expect(recordIndications(['CLI'], ['A PAH study'], matchers)).toEqual({ indications: ['CLI'], indicationSource: 'journey' });
    expect(recordIndications([], ['A PAH study'], matchers)).toEqual({ indications: ['PAH'], indicationSource: 'text' });
    expect(recordIndications([], ['Pharmacokinetics'], matchers)).toEqual({ indications: [] });
  });
});
