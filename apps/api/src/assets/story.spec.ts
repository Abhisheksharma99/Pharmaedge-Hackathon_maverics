import { approvalSteps, chapters, composeStory, productOf, toStoryEvent, weekly, type StoryInput } from './story.js';

const TODAY = '2026-10-10';
let n = 0;
const ev = (date: string, over: Record<string, unknown> = {}) => ({
  _id: `e${++n}`, asset: 'trep', date, type: 'trial_start', category: 'clinical', title: `Event on ${date}`, significance: 'High',
  is_milestone: false, origin: 'rule', sources: [{ collection: 'fda_records', record_key: `k${n}` }], ...over,
});
const approval = (date: string, product: string, region = 'US') => ev(date, { type: 'approval', category: 'regulatory', title: region === 'US' ? `FDA approves ${product}` : `EU marketing authorisation: ${product}`, region });

const TREP = { _id: 'trep', name: 'Treprostinil', company: { name: 'United Therapeutics' }, tags: { indications: ['PAH', 'PH-ILD'] } };
const base = (over: Partial<StoryInput> = {}): StoryInput => ({ asset: TREP, events: [], changes: [], slides: [], spec: {}, today: TODAY, ...over });

describe('journey story', () => {
  it('builds the approvals staircase from regulator approvals only, naming the product', () => {
    const events = [approval('2002-05-21', 'Remodulin'), approval('2009-07-30', 'Tyvaso'), ev('2021-03-31', { type: 'label_expansion', category: 'regulatory', title: 'FDA approves efficacy supplement for Tyvaso' }),
      ev('2026-03-09', { type: 'approval', category: 'regulatory', origin: 'ai', title: 'FDA approves inhaled treprostinil for PH-ILD' })].map((e) => toStoryEvent(e));
    expect(approvalSteps(events).map((s) => [s.product, s.level])).toEqual([['Remodulin', 1], ['Tyvaso', 2]]);
    expect(productOf('EU marketing authorisation: Trepulmix')).toBe('Trepulmix');
    // another company's product of the same molecule is not a step
    expect(approvalSteps([toStoryEvent({ ...approval('2025-05-23', 'Yutrepia'), sponsor: 'Liquidia', sponsor_is_company: false })])).toEqual([]);
  });

  it('splits the journey into chapters at approval waves, the focus window and what lies ahead', () => {
    const events = [ev('1999-01-01'), approval('2002-05-21', 'Remodulin'), approval('2004-01-01', 'Remodulin IV'), approval('2009-07-30', 'Tyvaso'),
      ev('2025-09-02'), ev('2026-10-08'), ev('2027-04-30', { is_milestone: true, type: 'regulatory_decision_expected', category: 'regulatory' })].map((e) => toStoryEvent(e));
    const ch = chapters(events, approvalSteps(events), TODAY, '2025-09-01');
    expect(ch.map((c) => [c.name, c.from, c.to, c.focus])).toEqual([
      ['Before first approval', '1999-01-01', '2002-05-21', false],
      ['Remodulin, Remodulin IV approved', '2002-05-21', '2009-07-30', false], // within three years: one wave
      ['Tyvaso approved', '2009-07-30', '2025-09-01', false],
      ['Since Sep 2025', '2025-09-01', TODAY, true],
      ['Ahead', TODAY, '2027-04-30', false],
    ]);
    expect(ch[3]!.events).toBe(2);
    expect(ch[4]!.events).toBe(1);
  });

  it('lays events in lanes with the filters, and reports what changed in the focus window', () => {
    const ph = ev('2021-03-31', { type: 'label_expansion', category: 'regulatory', title: 'FDA approves efficacy supplement for Tyvaso' });
    const misdated = ev('2026-03-09', { type: 'approval', category: 'regulatory', origin: 'ai', region: 'US', title: 'FDA approves inhaled treprostinil for PH-ILD',
      verification: { status: 'unconfirmed', note: 'No FDA approval record within 45 days', against: [ph._id] } });
    const readout = ev('2026-10-08', { type: 'trial_readout', title: 'TETON-1 meets primary endpoint' });
    const stopped = ev('2026-01-15', { type: 'trial_stopped', significance: 'Medium', title: 'Phase 2 trial stopped' });
    const low = ev('2026-02-01', { significance: 'Low', title: 'Minor study' });
    const moved = ev('2027-04-30', { is_milestone: true, type: 'regulatory_decision_expected', category: 'regulatory', title: 'FDA decision expected' });
    const story = composeStory(base({
      events: [ph, misdated, readout, stopped, low, moved],
      changes: [
        { event_id: moved._id, kind: 'changed', field: 'date', before: '2027-03-31', after: '2027-04-30', at: new Date('2026-10-01'), baseline: false, title: 'FDA decision expected', category: 'regulatory', event_date: '2027-04-30' },
        { event_id: readout._id, kind: 'added', at: new Date('2026-10-09'), baseline: true },
      ],
      slides: [{ record_key: 's1', slide_title: 'TETON-2 results', date: '2025-10-01', metrics: [{ metric: 'FVC change', value_text: '95 mL', validation: { status: 'conflict' } }, { metric: 'n', validation: { status: 'validated' } }] }],
      ledger: [{ decision: 'ingest', title: 'TETON-1 topline', date: '2026-10-08', source: 'PR Newswire', category: 'trial_readout' }, { decision: 'headline', title: 'x' }, { decision: 'skip', title: 'y' }],
      market: { listing: { ticker: 'UTHR', listed_name: 'United Therapeutics Corporation' }, source: 'test', bars: [{ date: '2026-10-07', close: 100 }, { date: '2026-10-08', close: 110 }, { date: '2026-10-09', close: 108 }] },
      spec: { since: '2025-09-01' },
    }));
    expect(story.range).toEqual({ from: '2021-01-01', to: '2027-12-31', today: TODAY });
    expect(story.lanes.map((l) => [l.category, l.events.length])).toEqual([['regulatory', 3], ['clinical', 2], ['company', 0], ['ip', 0]]); // Low left out
    expect(story.lanes[0]!.events.find((e) => e.id === moved._id)!.change).toMatchObject({ kind: 'changed', field: 'date', before: '2027-03-31' });
    expect(story.changes.developments.map((e) => e.title)).toEqual(['TETON-1 meets primary endpoint', 'FDA approves inhaled treprostinil for PH-ILD', 'Phase 2 trial stopped']);
    expect(story.changes.developments[0]!.impact).toMatchObject({ trading_day: '2026-10-08', day0: 10 });
    expect(story.changes.updates).toEqual([expect.objectContaining({ eventId: moved._id, field: 'date', after: '2027-04-30' })]); // baseline additions are not changes
    expect(story.changes.checks.map((e) => e.verification!.status)).toEqual(['unconfirmed']);
    expect(story.changes.slides).toEqual([{ recordKey: 's1', title: 'TETON-2 results', date: '2025-10-01', metric: 'FVC change', value: '95 mL' }]);
    expect(story.changes.trials.map((e) => e.type)).toEqual(['trial_stopped']);
    expect(story.changes.firstSeen).toMatchObject({ total: 2, kept: 1, headline: 1, items: [expect.objectContaining({ title: 'TETON-1 topline' })] });
    expect(story.changes.upcoming.map((e) => e.title)).toEqual(['FDA decision expected']);
    expect(story.market).toMatchObject({ ticker: 'UTHR', closes: [{ date: '2026-10-09', close: 108 }] }); // one close per week
  });

  it('compares two journeys on the same axis: approval lag, breadth, late-stage work, indications', () => {
    const story = composeStory(base({
      events: [approval('2002-05-21', 'Remodulin'), approval('2009-07-30', 'Tyvaso'), ev('2025-01-01', { phase: 'PHASE3' })],
      other: {
        asset: { _id: 'nint', name: 'Nintedanib', tags: { indications: ['IPF', 'PAH'] } },
        events: [approval('2014-10-15', 'Ofev'), approval('2015-01-15', 'Ofev', 'EU'), ev('2020-01-01', { phase: 'PHASE3' }), ev('2021-01-01', { phase: 'PHASE2', significance: 'Low' })],
      },
    }));
    expect(story.compare!.asset).toEqual({ id: 'nint', name: 'Nintedanib' });
    expect(story.compare!.events.map((e) => e.type)).toEqual(['approval', 'approval', 'trial_start']); // Phase 2 Low start left out
    expect(story.compare!.deltas).toEqual([
      { label: 'First FDA approval', primary: 'May 2002 (Remodulin)', other: 'Oct 2014 (Ofev)', note: 'Treprostinil first by 12.4 years' },
      { label: 'First EU approval', primary: 'none recorded', other: 'Jan 2015 (Ofev)' },
      { label: 'Approved products (US + EU)', primary: '2', other: '2' },
      { label: 'Phase 3 trials started', primary: '1', other: '1' },
      { label: 'Approved indications only one has', primary: 'PH-ILD', other: 'IPF' },
    ]);
  });

  it('keeps one close per week', () => {
    expect(weekly([{ date: '2026-10-05', close: 1 }, { date: '2026-10-09', close: 2 }, { date: '2026-10-12', close: 3 }])).toEqual([{ date: '2026-10-09', close: 2 }, { date: '2026-10-12', close: 3 }]);
  });
});
