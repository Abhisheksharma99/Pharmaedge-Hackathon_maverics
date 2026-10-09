import { BRANCH_PALETTE, CATEGORIES, CATEGORY_META, collectionMeta, NOTE_TAG_LIST, NOTE_TAGS, STAGES, trialStatusColor } from './constants'

describe('journey constants', () => {
  it('orders the branch palette trunk-first, as in the design', () => {
    expect(BRANCH_PALETTE).toEqual(['#2347d9', '#0b7a6f', '#6941c6', '#e0620f', '#0e7490', '#b54708'])
  })
  it('gives every category a colour, a soft colour and an icon', () => {
    for (const c of CATEGORIES) {
      expect(CATEGORY_META[c].color).toMatch(/^#[0-9a-f]{6}$/)
      expect(CATEGORY_META[c].soft).toMatch(/^#[0-9a-f]{6}$/)
      expect(CATEGORY_META[c].icon).toBeTruthy()
    }
  })
  it('lists note tags in design order with their colours', () => {
    expect(NOTE_TAG_LIST).toEqual(['Important', 'Missed by AI', 'Question', 'Risk', 'Opportunity'])
    expect(NOTE_TAGS['Missed by AI'].color).toBe('#6941c6')
  })
  it('has the five pipeline stages', () => {
    expect(STAGES).toEqual(['Phase 1', 'Phase 2', 'Phase 3', 'Filed', 'Approved'])
  })
  it('maps trial statuses to colours', () => {
    expect(trialStatusColor('RECRUITING')).toBe('#2347d9')
    expect(trialStatusColor('Active, not recruiting')).toBe('#5873e8')
    expect(trialStatusColor('COMPLETED')).toBe('#0b7a6f')
    expect(trialStatusColor('TERMINATED')).toBe('#b42318')
    expect(trialStatusColor('')).toBe('#98a2b3')
  })
  it('falls back for unknown collections', () => {
    expect(collectionMeta('trial_records').tab).toBe('clinical')
    expect(collectionMeta('mystery_records')).toEqual({ label: 'mystery', color: '#98a2b3', tab: null })
  })
})
