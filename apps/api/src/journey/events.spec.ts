import { noteToEvent, recordTab, toEventV3, type NoteDoc } from './events.js';

describe('toEventV3', () => {
  it('maps origin to via, merges links and hides internal fields', () => {
    const out = toEventV3({
      _id: 'rule:approval:x', origin: 'rule', title: 'FDA approves Tyvaso', links: ['a', 'b'], ai_links: ['b', 'c', 'rule:approval:x'],
      enriched_at: new Date(), merged_from: ['m'], updated_at: new Date(), branch: 'PAH', key: true,
    });
    expect(out).toMatchObject({ id: 'rule:approval:x', via: 'journey', title: 'FDA approves Tyvaso', branch: 'PAH', key: true });
    expect(out.links).toEqual(['a', 'b', 'c']);
    for (const k of ['_id', 'ai_links', 'enriched_at', 'merged_from', 'updated_at']) expect(out).not.toHaveProperty(k);
    expect(toEventV3({ _id: 'ai:1', origin: 'ai' }).via).toBe('ai_events');
    expect(toEventV3({ _id: 'ai:2', origin: 'ai' })).not.toHaveProperty('links');
  });
});

describe('noteToEvent', () => {
  it('turns a team note into a user journey event', () => {
    const note: NoteDoc = {
      _id: 'note:1', asset: 'trep', date: '2027-01-15', branch: 'PH-ILD', category: 'regulatory', tag: 'Missed by AI', title: 'Yutrepia approved',
      text: 'Seen in the press', mode: 'manual', sources: [], by: { id: 'u1', name: 'Alex' }, created_at: new Date('2026-10-01T10:00:00Z'),
    };
    expect(noteToEvent(note, '2026-10-09')).toMatchObject({
      id: 'note:1', via: 'user', type: 'note', key: true, is_milestone: true, branch: 'PH-ILD', summary: 'Seen in the press',
      user: { tag: 'Missed by AI', by: { id: 'u1', name: 'Alex' }, created_at: '2026-10-01T10:00:00.000Z', mode: 'manual' },
    });
  });
});

describe('recordTab', () => {
  it('maps collections and record types to asset tabs', () => {
    expect(recordTab('company_records', 'press_release')).toBe('company-ir');
    expect(recordTab('company_records', 'prescribing_info')).toBe('documents');
    expect(recordTab('fda_records', 'fda_submission')).toBe('regulatory');
    expect(recordTab('web_records', undefined)).toBeNull();
  });
});
