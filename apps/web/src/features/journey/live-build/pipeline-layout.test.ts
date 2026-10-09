import type { JobStep } from '@/features/jobs/api'
import { AG_COLUMNS, AG_EDGES, AG_H, AG_NODES, AG_W, agPath, edgeState, nodeVisible } from './pipeline-layout'

const steps = (entries: [string, JobStep['status']][]) => new Map(entries.map(([name, status]) => [name, { status }]))

describe('agent pipeline layout', () => {
  it('uses the design space and node boxes of the prototype', () => {
    expect([AG_W, AG_H]).toEqual([1100, 470])
    expect(Object.keys(AG_NODES)).toHaveLength(27)
    expect(AG_NODES['s:regulatory']).toEqual({ x: 16, y: 30, w: 206, h: 28 })
    expect(AG_NODES['s:competitors']).toEqual({ x: 16, y: 404, w: 206, h: 28 })
    expect(AG_NODES['c:fda_records']).toEqual({ x: 300, y: 44, w: 176, h: 38 })
    expect(AG_NODES['c:articles']).toEqual({ x: 300, y: 366, w: 176, h: 38 })
    expect(AG_NODES['r:journey']).toEqual({ x: 548, y: 44, w: 228, h: 60 })
    expect(AG_NODES['r:index']).toEqual({ x: 548, y: 348, w: 228, h: 60 })
    expect(AG_NODES['o:journey']).toEqual({ x: 846, y: 30, w: 240, h: 230 })
    expect(AG_NODES['o:assetai']).toEqual({ x: 846, y: 274, w: 240, h: 70 })
    expect(AG_NODES['o:compset']).toEqual({ x: 846, y: 356, w: 240, h: 88 })
    expect(AG_COLUMNS.map(([, x]) => x)).toEqual([16, 300, 548, 846])
  })

  it('draws the edges of the prototype', () => {
    expect(AG_EDGES).toHaveLength(33)
    const edge = (from: string, to: string) => AG_EDGES.find((e) => e.from === from && e.to === to)
    expect(edge('s:regulatory', 'c:fda_records')).toMatchObject({ d: 'M222,44 C264.9,44 257.1,63 300,63', steps: ['regulatory'], color: '#2347d9' })
    expect(edge('c:patent_records', 'r:journey')).toMatchObject({ d: 'M476,293 C515.6,293 508.4,91 548,91', steps: ['journey', 'finalize'] })
    expect(edge('r:ai_triage', 'r:ai_events')?.d).toBe('M662,210 C662,224 662,230 662,244')
    expect(edge('c:articles', 'r:index')).toMatchObject({ d: 'M476,385 C515.6,385 508.4,395 548,395', faint: true })
    expect(edge('s:competitors', 'o:compset')?.d).toBe('M222,418 C422,470 586,452 846,400')
    expect(new Set(AG_EDGES.map((e) => e.id)).size).toBe(33)
  })

  it('ends a path in the middle of the target unless told otherwise', () => {
    expect(agPath({ x: 0, y: 0, w: 10, h: 10 }, { x: 110, y: 0, w: 10, h: 20 }, {})).toBe('M10,5 C65,5 55,10 110,10')
  })

  it('is active while a step runs, done once its first step finished, pending before', () => {
    expect(edgeState(['journey', 'finalize'], steps([['journey', 'pending'], ['finalize', 'pending']]))).toBe('pending')
    expect(edgeState(['journey', 'finalize'], steps([['journey', 'running'], ['finalize', 'pending']]))).toBe('active')
    expect(edgeState(['journey', 'finalize'], steps([['journey', 'done'], ['finalize', 'pending']]))).toBe('done')
    expect(edgeState(['journey', 'finalize'], steps([['journey', 'done'], ['finalize', 'running']]))).toBe('active')
    expect(edgeState(['journey', 'finalize'], steps([['finalize', 'failed']]))).toBe('done')
    expect(edgeState(['news'], steps([['news', 'skipped']]))).toBe('done')
    expect(edgeState(['index'], steps([]))).toBe('pending')
  })

  it('shows the nodes a job plans, and a collection once it holds a record', () => {
    const plan = new Set(['regulatory', 'journey', 'finalize'])
    const records = { fda_records: 44, ema_records: 0 }
    const shown = Object.keys(AG_NODES).filter((k) => nodeVisible(k, plan, records))
    expect(shown).toEqual(['s:regulatory', 'c:fda_records', 'r:journey', 'o:journey'])
    expect(nodeVisible('o:assetai', new Set(['index']), {})).toBe(true)
    expect(nodeVisible('o:compset', new Set(['competitors']), {})).toBe(true)
    expect(nodeVisible('x:unknown', plan, records)).toBe(false)
  })
})
