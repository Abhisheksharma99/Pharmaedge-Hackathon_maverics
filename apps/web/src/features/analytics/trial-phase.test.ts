import { phaseColor, phaseGroup, phaseRank, phaseTag, sortTrialsByPhase } from './trial-phase'

describe('trial phases', () => {
  it('ranks Early 1 < 1 < 1/2 < 2 < 2/3 < 3 < 4 < other', () => {
    const phases = ['Phase 4', 'N/A', 'Phase 2/Phase 3', 'Phase 3', 'Phase 1', 'Phase 1/Phase 2', 'Early Phase 1', 'Phase 2']
    expect([...phases].sort((a, b) => phaseRank(a) - phaseRank(b))).toEqual([
      'Early Phase 1', 'Phase 1', 'Phase 1/Phase 2', 'Phase 2', 'Phase 2/Phase 3', 'Phase 3', 'Phase 4', 'N/A',
    ])
  })

  it('names the group, tag and colour of combined and unknown phases', () => {
    expect(phaseGroup('Phase 1/Phase 2')).toBe('Phase 1/2')
    expect(phaseGroup('Phase 3')).toBe('Phase 3')
    expect(phaseGroup('N/A')).toBe('Other')
    expect(phaseTag('Phase 2/Phase 3')).toBe('P2/3')
    expect(phaseTag('Early Phase 1')).toBe('EP1')
    expect(phaseColor('Phase 2/Phase 3')).toBe(phaseColor('Phase 3'))
    expect(phaseColor('N/A')).toBe('#98a2b3')
  })

  it('sorts by phase, then start date, undated last', () => {
    const rows = [
      { phase: 'Phase 3', start: '2010-01' },
      { phase: 'Phase 2', start: '2015-01' },
      { phase: 'Phase 3', start: '' },
      { phase: 'Phase 3', start: '2005-01' },
      { phase: 'Phase 2', start: '2012-01' },
    ]
    expect(sortTrialsByPhase(rows).map((r) => `${r.phase}|${r.start}`)).toEqual([
      'Phase 2|2012-01', 'Phase 2|2015-01', 'Phase 3|2005-01', 'Phase 3|2010-01', 'Phase 3|',
    ])
  })
})
