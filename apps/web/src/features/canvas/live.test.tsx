import { render, screen } from '@testing-library/react'
import type { CanvasNode } from './api'
import { CanvasView } from './canvas-view'
import { useLiveCanvases } from './live-store'

const node = (id: string, kind: CanvasNode['kind'], label: string, children: CanvasNode[] = [], extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, kind, label, children, ...extra })

describe('live canvas', () => {
  it('grows a streamed canvas branch by branch, under the given parent, and drops it when finished', () => {
    const s = useLiveCanvases.getState()
    s.start('c1', { assetId: 'trep', title: 'Journey', tree: node('asset', 'asset', 'Treprostinil') })
    s.addNodes('c1', 'asset', [node('c-regulatory', 'group', 'Regulatory')])
    s.addNodes('c1', 'c-regulatory', [node('c-regulatory-2024', 'group', '2024')])
    s.addNodes('other', 'asset', [node('x', 'group', 'ignored')]) // not building: ignored
    expect(useLiveCanvases.getState().live.c1!.tree).toEqual(
      node('asset', 'asset', 'Treprostinil', [node('c-regulatory', 'group', 'Regulatory', [node('c-regulatory-2024', 'group', '2024')])]),
    )
    expect(useLiveCanvases.getState().live.other).toBeUndefined()
    s.finish('c1')
    expect(useLiveCanvases.getState().live).toEqual({})
  })

  it('marks new nodes, shows events no longer in the data, and allows no edits while building', () => {
    const tree = node('asset', 'asset', 'Treprostinil', [
      node('e-1', 'event', 'New PDUFA date', [], { date: '2026-01-05' }),
      node('stale', 'group', 'No longer in the data (review)', [node('e-2', 'event', 'TETON-2', [], { date: '2025-09-02', stale: true })]),
    ])
    render(<CanvasView tree={tree} readOnly highlight={new Set(['e-1'])} onChange={() => {}} onOpenSource={() => {}} />)
    expect(screen.getAllByText('New')).toHaveLength(1)
    expect(screen.getByText(/no longer in the data$/)).toBeInTheDocument()
    screen.getByTitle('Treprostinil').click()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
  })
})
