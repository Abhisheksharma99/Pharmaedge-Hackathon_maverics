import { fireEvent, render } from '@testing-library/react'
import { HorizontalTrack } from './horizontal-track'
import { branchModel, laneOf } from './journey-model'
import { trackLayout } from './track-layout'
import type { Branch, JourneyEventV3 } from './types'

const iconRenders = vi.hoisted(() => ({ n: 0 }))
vi.mock('@/features/assets/components/badges', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/assets/components/badges')>()
  return {
    ...actual,
    CategoryIcon: (props: React.ComponentProps<typeof actual.CategoryIcon>) => {
      iconRenders.n++
      return actual.CategoryIcon(props)
    },
  }
})

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: id, color: '#2347d9', off, status: 'Approved · US', origin: 'ai', ...extra })
const MODEL = branchModel([br('PAH', 0, { trunk: true }), br('CTEPH', -1, { from: 'PAH' })])
const ev = (id: string, date: string, branch: string): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey',
})
const LIST = [ev('a', '2002-05-21', 'PAH'), ev('b', '2004-11-23', 'CTEPH'), ev('c', '2010-01-01', 'PAH'), ev('d', '2012-01-01', 'CTEPH')]

describe('HorizontalTrack card memoisation', () => {
  it('does not re-render the cards when the hover pill moves', () => {
    const { container } = render(
      <HorizontalTrack assetId="trep" list={LIST} model={MODEL} closures={{}} stars={[]} comments={{}} focusBranch={null} onOpen={vi.fn()} onAdd={vi.fn()} onActive={vi.fn()} />,
    )
    const L = trackLayout({ list: LIST, branches: MODEL.list, laneOf: (e) => laneOf(e, MODEL), vw: 1000, vh: window.innerHeight, closures: {}, today: '2026-10-09' })
    const svg = container.querySelector('svg')!
    expect(container.querySelectorAll('[data-card]').length).toBe(LIST.length)
    expect(iconRenders.n).toBeGreaterThanOrEqual(LIST.length)
    iconRenders.n = 0
    fireEvent.mouseMove(svg, { clientX: (L.xs[0]! + L.xs[1]!) / 2, clientY: L.rowY('PAH')! })
    expect(container.querySelector('[data-hover-pill]')).toBeInTheDocument()
    fireEvent.mouseMove(svg, { clientX: (L.xs[1]! + L.xs[2]!) / 2, clientY: L.rowY('CTEPH')! })
    expect(iconRenders.n).toBe(0)
  })
})
