import type { AssetAnalytics } from './api'
import { approvedIndications } from './approved'

const base = {
  stats: {} as AssetAnalytics['stats'],
  pipeline: [
    { id: 'a', label: 'PAH', stage: 4, ended: null },
    { id: 'b', label: 'PH-ILD', stage: 4, ended: null },
    { id: 'c', label: 'IPF', stage: 2, ended: null },
    { id: 'd', label: 'COPD', stage: 4, ended: '2018-01-01' },
  ] as AssetAnalytics['pipeline'],
  landscape: { cols: ['Pulmonary arterial hypertension (PAH)', 'IPF'], rows: [{ id: 'x', name: 'Self', company: null, me: true, cells: { 'Pulmonary arterial hypertension (PAH)': 'approved', IPF: 'investigational' } }] } as AssetAnalytics['landscape'],
}

describe('approvedIndications', () => {
  it('uses the API list when present', () => {
    const approved = [{ indication: 'PAH', regions: ['US', 'EU'] }]
    expect(approvedIndications({ ...base, stats: { approved } as AssetAnalytics['stats'] }, ['US'])).toBe(approved)
  })

  it('derives from approved, not terminated pipeline rows with the asset regions', () => {
    expect(approvedIndications(base, ['US', 'EU'])).toEqual([
      { indication: 'PAH', regions: ['US', 'EU'] },
      { indication: 'PH-ILD', regions: ['US', 'EU'] },
    ])
  })

  it('falls back to the asset\'s approved landscape cells', () => {
    expect(approvedIndications({ ...base, pipeline: [] }, ['US'])).toEqual([{ indication: 'PAH', regions: ['US'] }])
    expect(approvedIndications({ ...base, pipeline: [], landscape: { cols: [], rows: [] } }, ['US'])).toEqual([])
  })
})
