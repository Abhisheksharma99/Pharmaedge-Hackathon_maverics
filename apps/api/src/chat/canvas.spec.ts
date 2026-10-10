import { buildJourneyTree, cleanTree, eventNodeId, mergeTree, STALE_GROUP_ID, type CanvasNode } from './canvas.js';

const ASSET = { _id: 'trep', name: 'Treprostinil' };
const ev = (id: string, date: string, category = 'regulatory', title = `Event ${id}`) => ({ _id: id, date, category, title, significance: 'High' });
const find = (t: CanvasNode, id: string): CanvasNode | undefined => (t.id === id ? t : t.children.map((c) => find(c, id)).find(Boolean));
const labels = (t: CanvasNode): string[] => [t.label, ...t.children.flatMap(labels)];

describe('journey canvas', () => {
  it('derives node ids from the data, so the same events give the same tree, and they pass the save check', () => {
    const events = [ev('rule:a', '2024-05-01'), ev('ai:b', '2022-01-01', 'clinical')];
    const a = buildJourneyTree(ASSET, events, 'category');
    expect(buildJourneyTree(ASSET, [...events].reverse(), 'category')).toEqual(a);
    expect(a.children.map((c) => c.id)).toEqual(['c-regulatory', 'c-clinical']);
    expect(a.children[0]!.children[0]).toMatchObject({ id: 'c-regulatory-2024', label: '2024' });
    expect(find(a, eventNodeId('rule:a'))).toMatchObject({ kind: 'event', eventId: 'rule:a' });
    expect(cleanTree(a)).toEqual(a);
    expect(buildJourneyTree(ASSET, events, 'year').children.map((c) => c.id)).toEqual(['y-2024', 'y-2022']);
  });

  it('merges new events into an edited canvas and keeps renames, notes, folds and deletions', () => {
    const saved = buildJourneyTree(ASSET, [ev('a', '2024-05-01'), ev('b', '2024-06-01'), ev('c', '2023-01-01', 'clinical'), ev('gone', '2021-01-01')], 'category');
    const reg = find(saved, 'c-regulatory')!;
    reg.label = 'FDA story';
    reg.collapsed = true;
    reg.children.push({ id: 'my-note', kind: 'note', label: 'Watch the label update', children: [] });
    find(saved, eventNodeId('a'))!.note = 'key approval';
    find(saved, 'c-regulatory-2021')!.children.push({ id: 'note-2', kind: 'note', label: 'orphan soon', children: [] }); // 2021 empties upstream

    // Latest data: d is new, "gone" was removed upstream, all of clinical was deleted by the user (dismissed c).
    const fresh = buildJourneyTree(ASSET, [ev('a', '2024-05-01'), ev('b', '2024-06-01'), ev('c', '2023-01-01', 'clinical'), ev('d', '2025-02-01')], 'category');
    const { tree, added, stale } = mergeTree(fresh, saved, new Set(['c']));

    expect(find(tree, 'c-regulatory')).toMatchObject({ label: 'FDA story', collapsed: true });
    expect(find(tree, 'c-regulatory')!.children.at(-1)).toMatchObject({ id: 'my-note', kind: 'note' });
    expect(find(tree, eventNodeId('a'))).toMatchObject({ note: 'key approval' });
    expect(added).toEqual([eventNodeId('d'), 'c-regulatory-2025']);
    expect(find(tree, 'c-clinical')).toBeUndefined(); // deleted by the user: not back
    expect(tree.children.find((c) => c.id === 'note-2')).toMatchObject({ label: 'orphan soon' }); // its branch is gone: kept at the root
    expect(stale).toBe(1);
    expect(find(tree, STALE_GROUP_ID)!.children).toEqual([expect.objectContaining({ eventId: 'gone', stale: true })]);
    expect(cleanTree(tree)).toEqual(tree); // the merged tree can be saved as is

    // Merging again with nothing new changes nothing.
    expect(mergeTree(fresh, tree, new Set(['c'])).tree).toEqual(tree);
  });

  it('matches events of canvases built before stable ids by their event id', () => {
    const legacy: CanvasNode = { id: 'n1', kind: 'asset', label: 'Treprostinil', children: [
      { id: 'n2', kind: 'group', label: 'Regulatory', children: [{ id: 'n3', kind: 'event', label: 'My name for it', eventId: 'a', children: [] }] },
    ] };
    const { tree } = mergeTree(buildJourneyTree(ASSET, [ev('a', '2024-05-01')], 'category'), legacy, new Set());
    expect(find(tree, eventNodeId('a'))).toMatchObject({ label: 'My name for it' });
    expect(labels(tree)).not.toContain('Event a');
  });
});
