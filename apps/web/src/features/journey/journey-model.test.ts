import {
  branchClosures,
  branchModel,
  chronological,
  filterJourney,
  gapLabel,
  howBuilt,
  journeyCounts,
  laneOf,
  lineage,
  SINGLE_TRUNK,
  sourceRefs,
  spanOf,
  subtree,
  subtreeSize,
  viaLabel,
} from './journey-model'
import type { Branch, JourneyEventV3 } from './types'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({
  id, label: id, full: `${id} full`, color: '#123456', off, status: 'Approved · US', origin: 'ai', ...extra,
})
const BRANCHES = [br('PAH', 0, { trunk: true }), br('PH-ILD', 2, { from: 'PAH' }), br('IPF', 3, { from: 'PH-ILD' }), br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated' })]

let n = 0
const ev = (date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id: `e${++n}`, asset: 'trep', date, type: 'trial_start', category: 'clinical', title: `Event ${n}`, significance: 'High',
  is_milestone: false, sources: [], via: 'journey', ...extra,
})

describe('branchModel / laneOf / spanOf', () => {
  it('uses the branch docs, trunk first, and falls back to one unlabeled trunk', () => {
    const m = branchModel(BRANCHES)
    expect(m.multi).toBe(true)
    expect(m.trunk.id).toBe('PAH')
    expect(m.byId.get('IPF')?.from).toBe('PH-ILD')
    const single = branchModel([])
    expect(single).toMatchObject({ multi: false, trunk: SINGLE_TRUNK, list: [SINGLE_TRUNK] })
    expect(branchModel(undefined).multi).toBe(false)
  })

  it('puts events without a known branch on the trunk', () => {
    const m = branchModel(BRANCHES)
    expect(laneOf({ branch: 'IPF' }, m)).toBe('IPF')
    expect(laneOf({ branch: 'Gone' }, m)).toBe('PAH')
    expect(laneOf({}, m)).toBe('PAH')
    expect(laneOf({ branch: 'IPF' }, branchModel([]))).toBe('journey')
  })

  it('bridges only to other known branches', () => {
    const m = branchModel(BRANCHES)
    expect(spanOf({ branch: 'PAH', span: ['PAH', 'PH-ILD', 'X', 'PH-ILD'] }, m)).toEqual(['PH-ILD'])
    expect(spanOf({ branch: 'PAH', span: ['PH-ILD'] }, branchModel([]))).toEqual([])
  })
})

describe('chronological / filterJourney / journeyCounts', () => {
  it('drops undated events and sorts by date then id', () => {
    const a = ev('2021-03-01', { id: 'b' })
    const b = ev('2021-03-01', { id: 'a' })
    const c = ev('2002-05-21')
    const out = chronological([a, ev(''), c, b, ev('soon')])
    expect(out.map((e) => e.id)).toEqual([c.id, 'a', 'b'])
  })

  it('keeps partial dates in order', () => {
    expect(chronological([ev('2021-03-04'), ev('2021'), ev('2021-03')]).map((e) => e.date)).toEqual(['2021', '2021-03', '2021-03-04'])
  })

  it('filters by category, starred and team notes, and counts before filtering', () => {
    const note = ev('2020-01-01', { via: 'user', category: 'regulatory' })
    const star = ev('2019-01-01', { category: 'ip' })
    const plain = ev('2018-01-01')
    const all = [plain, star, note]
    expect(filterJourney(all, { cats: ['ip', 'regulatory'], mine: null }, []).map((e) => e.id)).toEqual([star.id, note.id])
    expect(filterJourney(all, { cats: [], mine: 'starred' }, [star.id])).toEqual([star])
    expect(filterJourney(all, { cats: [], mine: 'notes' }, [])).toEqual([note])
    expect(journeyCounts(all, [star.id, 'elsewhere'])).toEqual({
      cats: { regulatory: 1, clinical: 1, company: 0, ip: 1 },
      starred: 1,
      notes: 1,
    })
  })
})

describe('branchClosures', () => {
  it('closes an ended branch at its last stopped trial, not at later publications (PH-COPD 2022)', () => {
    const events = [
      ev('2018-05-08', { branch: 'PH-COPD', title: 'Phase 3 trial started: PERFECT' }),
      ev('2022-10-13', { branch: 'PH-COPD', type: 'trial_stopped', title: 'Phase 3 trial terminated: PERFECT' }),
      ev('2022-11-29', { branch: 'PH-COPD', type: 'trial_stopped', title: 'Phase 3 trial terminated: PERFECT OLE' }),
      ev('2025-03-18', { branch: 'PH-COPD', type: 'safety', title: 'PERFECT stopped early' }),
      ev('2004-09-01', { branch: 'CLI', type: 'publication' }),
    ]
    const out = branchClosures(events, ['PH-COPD', 'CLI', 'PPHN'])
    expect(out['PH-COPD']).toMatchObject({ date: '2022-11-29', title: 'Phase 3 trial terminated: PERFECT OLE' })
    expect(out.CLI?.date).toBe('2004-09-01')
    expect(out.PPHN).toBeUndefined()
  })
})

describe('lineage / gapLabel', () => {
  it('walks parents from the root and survives unknown parents and cycles', () => {
    const m = branchModel(BRANCHES)
    expect(lineage('IPF', m).map((b) => b.id)).toEqual(['PAH', 'PH-ILD', 'IPF'])
    expect(lineage('Nope', m)).toEqual([])
    const loop = branchModel([br('A', 0, { trunk: true, from: 'B' }), br('B', 1, { from: 'A' })])
    expect(lineage('B', loop).map((b) => b.id)).toEqual(['A', 'B'])
  })

  it('reads days up to 400, then years', () => {
    expect(gapLabel(1)).toBe('1 day')
    expect(gapLabel(78)).toBe('78 days')
    expect(gapLabel(400)).toBe('400 days')
    expect(gapLabel(1680)).toBe('4.6 years')
  })
})

describe('sources, via and how it was built', () => {
  it('merges sources and merged_sources once each', () => {
    const e = ev('2021-01-01', {
      sources: [{ collection: 'fda_records', record_key: 'a' }],
      merged_sources: [{ collection: 'fda_records', record_key: 'a' }, { collection: 'articles', record_key: 'b' }],
    })
    expect(sourceRefs(e)).toHaveLength(2)
  })

  it('labels each origin', () => {
    const one = [{ collection: 'trial_records', record_key: 'ctgov:NCT1' }]
    expect(viaLabel(ev('2021-01-01', { sources: one }))).toBe('Rule · trial_records')
    expect(viaLabel(ev('2021-01-01'))).toBe('Rule')
    expect(viaLabel(ev('2021-01-01', { via: 'ai_events', sources: one }))).toBe('AI · 1 record')
    expect(viaLabel(ev('2021-01-01', { via: 'ai_events', sources: [...one, { collection: 'articles', record_key: 'u' }] }))).toBe('AI · merged 2 records')
    expect(viaLabel(ev('2021-01-01', { via: 'finalize', sources: one }))).toBe('Rebuild · trial_records')
    const user = { tag: 'Risk' as const, by: { id: 'u1', name: 'Ana Analyst' }, created_at: '2026-10-01T10:00:00Z', mode: 'manual' as const }
    expect(viaLabel(ev('2021-01-01', { via: 'user', user }))).toBe('Added by Ana Analyst')
    expect(howBuilt(ev('2021-01-01', { via: 'ai_events' }), 3)).toBe('Extracted and consolidated by AI from 3 records.')
    expect(howBuilt(ev('2021-01-01', { type: 'approval' }), 1)).toBe('Mapped by rule (approval).')
    expect(howBuilt(ev('2021-01-01', { via: 'user', user }), 0)).toBe('Added by a team member.')
  })
})

describe('subtree', () => {
  it('lists the single record with its key facts, the indications and the linked events it can resolve', () => {
    const linked = ev('2025-09-30', { id: 'L1', title: 'FDA accepts Tyvaso sNDA', category: 'regulatory' })
    const e = ev('2021-06-01', {
      sources: [{ collection: 'trial_records', record_key: 'ctgov:NCT04708782' }],
      details: { Trial: 'NCT04708782', Phase: 'Phase 3', Enrollment: '~600', 'Primary endpoint': 'FVC', Status: 'Active' },
      indications: ['IPF'],
      links: ['L1', 'missing'],
    })
    const nodes = subtree(e, (id) => (id === 'L1' ? linked : undefined))
    expect(nodes.map((x) => x.label)).toEqual(['ctgov:NCT04708782', 'Indications', 'Linked journey events'])
    expect(nodes[0]!.children!.map((c) => `${c.sub}:${c.label}`)).toEqual(['Trial:NCT04708782', 'Phase:Phase 3', 'Enrollment:~600', 'Primary endpoint:FVC'])
    expect(nodes[2]!.children).toEqual([{ label: 'FDA accepts Tyvaso sNDA', sub: '2025-09-30', eventId: 'L1', color: '#2347d9' }])
    expect(subtreeSize(nodes)).toBe(3 + 4 + 1 + 1)
  })

  it('groups consolidated records and says when a note was added by hand', () => {
    const merged = ev('2021-01-01', { sources: [{ collection: 'articles', record_key: 'a' }, { collection: 'fda_records', record_key: 'b' }] })
    expect(subtree(merged, () => undefined)[0]).toMatchObject({ label: 'Consolidated from 2 records', children: [{ label: 'a', mono: true }, { label: 'b' }] })
    const user = { tag: 'Question' as const, by: { id: 'u1', name: 'Ana Analyst' }, created_at: '2026-10-01T10:00:00Z', mode: 'manual' as const }
    expect(subtree(ev('2021-01-01', { via: 'user', user }), () => undefined)[0]).toEqual({
      label: 'Added manually',
      children: [{ label: 'Ana Analyst', sub: '2026-10-01' }],
    })
  })
})
