import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { todayIso } from '@/lib/dates'
import type { JourneyViewHandle } from '../view-types'
import { branchModel, spanOf } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { estimateRowHeight, rowTops, treeGeometry } from './tree-geometry'
import { JourneyTree, type JourneyTreeProps } from './journey-tree'
import { treeRows } from './tree-rows'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra })
const MODEL = branchModel([
  br('PAH', 0, { trunk: true, color: '#2347d9' }),
  br('PH-ILD', 2, { from: 'PAH', why: 'INCREASE took inhaled treprostinil into WHO Group 3' }),
  br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated', color: '#b54708' }),
])
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const LIST = [
  ev('a', '2002-05-21', 'PAH'), ev('b', '2004-11-23', 'PAH'), ev('c', '2017-02-01', 'PH-ILD'), ev('d', '2018-05-08', 'PH-COPD'),
  ev('e', '2022-01-10', 'PAH'), ev('f', '2024-06-06', 'PH-COPD'), ev('ai:trep:https://x.org/a/b:0', '2099-04-30', 'PH-ILD', { is_milestone: true }),
]
const CLOSURES = { 'PH-COPD': { id: 'stop', date: '2022-11-29', title: 'Phase 3 trial terminated: PERFECT' } }

function renderTree(over: Partial<JourneyTreeProps> = {}) {
  const ref = createRef<JourneyViewHandle>()
  const props: JourneyTreeProps = {
    assetId: 'trep', list: LIST, model: MODEL, closures: CLOSURES, stars: [], comments: {}, focusBranch: null,
    onOpen: vi.fn(), onAdd: vi.fn(), onActive: vi.fn(), onStar: vi.fn(), onJump: vi.fn(), ...over,
  }
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <JourneyTree ref={ref} {...props} />
    </QueryClientProvider>,
  )
  const rows = treeRows(props.list, MODEL, CLOSURES, todayIso())
  const heights = rows.map(estimateRowHeight)
  const { tops, H } = rowTops(heights)
  const geo = treeGeometry({ W: 1200, rows, tops, heights, H, model: MODEL, spanOf: (e) => spanOf(e, MODEL) })
  return { ...view, props, ref, geo }
}

describe('JourneyTree', () => {
  it('forks branches with their rationale, closes PH-COPD at its 2022 termination and marks Today', async () => {
    const { container } = renderTree({ list: LIST.map((e) => ({ ...e, significance: 'Low' as const })) })
    expect(await screen.findByText(/^Today · /)).toBeInTheDocument()
    expect(screen.getByText('PH-ILD full')).toBeInTheDocument()
    expect(screen.getByText('Forked from PAH · INCREASE took inhaled treprostinil into WHO Group 3')).toBeInTheDocument()
    expect(screen.getByText('Terminated Nov 2022 · Phase 3 trial terminated: PERFECT')).toBeInTheDocument()
    expect(container.querySelector('[data-cap="PH-COPD"]')).toBeInTheDocument()
    expect(container.querySelector('[data-lane="PH-COPD"] [data-tail]')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN/)
  })

  it('ends with a note about dashed milestones only when the journey has projected ones', () => {
    const short = [ev('a', '2002-05-21', 'PAH'), ev('m', '2099-04-30', 'PAH', { is_milestone: true })]
    const withMilestone = renderTree({ list: short, model: branchModel([]) })
    expect(screen.getByText('Projected milestones are dashed')).toBeInTheDocument()
    withMilestone.unmount()
    renderTree({ list: short.slice(0, 1), model: branchModel([]) })
    expect(screen.getByText('End of the recorded journey')).toBeInTheDocument()
  })

  it('shows the hover date and branch over the lanes and adds a note there on click', () => {
    const { geo, props } = renderTree()
    const gutter = screen.getByTestId('tree-gutter')
    const a = geo.nodes.find((n) => n.k === 'a')!
    const b = geo.nodes.find((n) => n.k === 'b')!
    fireEvent.mouseMove(gutter, { clientX: geo.tx + 2, clientY: (a.y + b.y) / 2 })
    // The hover pill is decorative (aria-hidden): the click target is the gutter itself.
    const pill = screen.getByText('Click to add a note').parentElement!
    expect(pill).toHaveAttribute('aria-hidden', 'true')
    expect(pill).toHaveTextContent(/^[A-Z][a-z]{2} \d{1,2}, 200[234]· PAHClick to add a note$/)
    fireEvent.click(gutter, { clientX: geo.tx + 2, clientY: (a.y + b.y) / 2 })
    expect(props.onAdd).toHaveBeenCalledWith(expect.objectContaining({ branch: 'PAH', prev: 'Event a', next: 'Event b' }))
  })

  it('stars and opens cards, and jumps to an event with ":" and "/" in its id', async () => {
    const { props, ref } = renderTree()
    const card = screen.getByRole('article', { name: 'Event b' })
    await userEvent.click(within(card).getByRole('button', { name: 'Mark as important' }))
    expect(props.onStar).toHaveBeenCalledWith('b')
    await userEvent.click(within(card).getByRole('button', { name: /Details/ }))
    expect(props.onOpen).toHaveBeenCalledWith('b')
    let ok = false
    act(() => {
      ok = ref.current!.jump('ai:trep:https://x.org/a/b:0')
    })
    expect(ok).toBe(true)
    expect(ref.current!.jump('missing')).toBe(false)
  })

  it('renders only rows near the viewport for a 1,270-event journey', () => {
    const many = Array.from({ length: 1270 }, (_, i) => ev(`e${i}`, `${1990 + Math.floor(i / 40)}-${String((i % 12) + 1).padStart(2, '0')}-10`, 'PAH', { significance: 'Low' }))
    const { container } = renderTree({ list: many })
    const rendered = container.querySelectorAll('[data-row]').length
    expect(rendered).toBeGreaterThan(3)
    expect(rendered).toBeLessThan(60)
  })

  it('draws one unlabeled trunk and no forks for an asset without branches', () => {
    renderTree({ model: branchModel([]), list: LIST.map((e) => ({ ...e, branch: undefined })) })
    expect(screen.queryByText(/New branch/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Journey begins/)).not.toHaveTextContent('trunk')
  })

  it('leaves undated events off the tree and shows the HUD for the active event', () => {
    const { container } = renderTree({ list: [...LIST, ev('u', '', 'PAH', { title: 'Undated one' })] })
    expect(screen.queryByText('Undated one')).not.toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN/)
    expect(screen.getByText(/^01\/07$/)).toBeInTheDocument()
  })

  it('keeps the starred ring when a card is also the active one', () => {
    renderTree({ stars: ['a'] })
    const card = screen.getByRole('article', { name: 'Event a' }).firstElementChild!
    expect(card.className).toContain('inset_0_0_0_2px_var(--star)')
  })

  it('shows a chip bar and right-hand cards below 980px', () => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 700, height: 0, top: 0, left: 0, right: 700, bottom: 0, x: 0, y: 0, toJSON: () => ({}) })
    try {
      const { container } = renderTree()
      const chips = container.querySelectorAll('[data-ly]')
      expect(chips).toHaveLength(3)
      expect(Array.from(chips).every((c) => c.tagName === 'SPAN' && c.parentElement!.className.includes('flex-wrap'))).toBe(true)
      expect(screen.getByRole('article', { name: 'Event a' })).toHaveClass('justify-end')
      expect(container.innerHTML).not.toMatch(/NaN/)
    } finally {
      spy.mockRestore()
    }
  })

  it('fades everything outside the focused branch', () => {
    const { container } = renderTree({ focusBranch: 'PH-ILD' })
    expect(screen.getByRole('article', { name: 'Event a' })).toHaveClass('opacity-30')
    expect(screen.getByRole('article', { name: 'Event c' })).not.toHaveClass('opacity-30')
    expect(container.querySelector('[data-lane="PAH"]')).toHaveClass('opacity-[0.18]')
    expect(container.querySelector('[data-lane="PH-ILD"]')).not.toHaveClass('opacity-[0.18]')
  })

  it('reveals everything at once without parallax under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
    try {
      const { container } = renderTree()
      expect(container.querySelector('[data-node="a"] circle')).toHaveClass('scale-100')
      expect((container.querySelector('[data-bgyear]') as HTMLElement).style.translate).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('writes the parallax offset as the translate property, keeping the centring', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    try {
      const { container } = renderTree()
      expect((container.querySelector('[data-bgyear]') as HTMLElement).style.translate).toMatch(/^-50% -?[\d.]+px$/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('has no NaN in the SVG of a single trunk', () => {
    const { container } = renderTree({ model: branchModel([]), list: LIST.map((e) => ({ ...e, branch: undefined })) })
    expect(container.querySelector('svg')!.outerHTML).not.toMatch(/NaN/)
  })
})
