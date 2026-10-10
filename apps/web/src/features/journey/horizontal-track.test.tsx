import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { todayIso } from '@/lib/dates'
import { HorizontalTrack } from './horizontal-track'
import { branchModel, laneOf } from './journey-model'
import { trackLayout } from './track-layout'
import type { Branch, JourneyEventV3 } from './types'
import type { JourneyViewHandle, JourneyViewProps } from './view-types'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: id, color: '#0e7490', off, status: 'Approved · EU', origin: 'ai', ...extra })
const MODEL = branchModel([br('PAH', 0, { trunk: true, color: '#2347d9', status: 'Approved · US' }), br('CTEPH', -1, { from: 'PAH' }), br('PH-COPD', -5, { from: 'PAH', ended: 'Terminated', color: '#b54708' }), br('PPF', 4, { from: 'PAH', status: 'Phase 3 recruiting' })])
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const LIST = [
  ev('a', '2002-05-21', 'PAH'), ev('b', '2004-11-23', 'PAH'), ev('c', '2018-05-08', 'PH-COPD'), ev('d', '2020-04-03', 'CTEPH'),
  ev('e', '2022-01-10', 'PAH'), ev('f', '2023-05-22', 'PAH'), ev('g', '2024-06-06', 'PH-COPD'), ev('ai:trep:https://x.org/a/b:0', '2027-04-30', 'PAH', { is_milestone: true }),
]
const CLOSURES = { 'PH-COPD': { id: 'stop', date: '2022-11-29', title: 'PERFECT terminated' } }

function renderTrack(over: Partial<JourneyViewProps> = {}) {
  const ref = createRef<JourneyViewHandle>()
  const props: JourneyViewProps = { assetId: 'trep', list: LIST, model: MODEL, closures: CLOSURES, stars: ['a'], comments: { a: [{}, {}] }, focusBranch: null, onOpen: vi.fn(), onAdd: vi.fn(), onActive: vi.fn(), ...over }
  const view = render(<HorizontalTrack ref={ref} {...props} />)
  // jsdom: no layout, so the track measures a 1000px pin in a 768px window.
  const L = trackLayout({ list: props.list, branches: MODEL.list, laneOf: (e) => laneOf(e, MODEL), vw: 1000, vh: window.innerHeight, closures: CLOSURES, today: todayIso() })
  return { ...view, props, ref, L }
}

describe('HorizontalTrack', () => {
  it('pins a label per branch row, caps the closed branch and draws Today', () => {
    const { container } = renderTrack()
    expect(container.querySelector('[data-row="PH-COPD"]')).toHaveTextContent('PH-COPD')
    expect(container.querySelector('[data-row="PAH"]')).toHaveTextContent('trunk')
    // A branch with no event in the list has no row (its card stays in the header).
    expect(container.querySelector('[data-row="PPF"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-lane="PPF"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-lane="PH-COPD"] [data-cap]')).toBeInTheDocument()
    expect(container.querySelector('[data-lane="PH-COPD"] [data-tail]')).toBeInTheDocument()
    expect(container.querySelector('[data-lane="PAH"] [data-cap]')).not.toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN/)
  })

  it('shows date, branch and the add hint on hover, and hands the same date and branch to the composer on click', () => {
    const { container, props, L } = renderTrack()
    const svg = container.querySelector('svg')!
    const x = (L.xs[3]! + L.xs[4]!) / 2
    fireEvent.mouseMove(svg, { clientX: x, clientY: L.rowY('CTEPH')! })
    const pill = container.querySelector('[data-hover-pill]')
    expect(pill).toHaveTextContent(/^[A-Z][a-z]{2} \d{1,2}, 202[01]· CTEPHClick to add a note$/)
    fireEvent.click(svg, { clientX: x, clientY: L.rowY('CTEPH')! })
    expect(props.onAdd).toHaveBeenCalledWith(expect.objectContaining({ branch: 'CTEPH', prev: 'Event d', next: 'Event e' }))
    const { date } = (props.onAdd as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(date > '2020-04-03' && date < '2022-01-10').toBe(true)
    fireEvent.mouseLeave(svg)
    expect(container.querySelector('[data-hover-pill]')).not.toBeInTheDocument()
  })

  it('opens a card, marks stars and comments, and keeps one tab stop that ←/→ move', async () => {
    const { container, props } = renderTrack()
    const first = container.querySelector<HTMLButtonElement>('[data-card="a"]')!
    expect(first).toHaveAttribute('tabindex', '0')
    expect(first.querySelector('[aria-label="Starred"]')).toBeInTheDocument()
    expect(first).toHaveTextContent('2')
    expect(container.querySelector('[data-card="b"]')).toHaveAttribute('tabindex', '-1')
    await userEvent.click(first)
    expect(props.onOpen).toHaveBeenCalledWith('a')
    first.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(container.querySelector('[data-card="b"]')).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(first).toHaveFocus()
  })

  it('renders only the cards near the viewport for a 1,270-event journey', () => {
    const many = Array.from({ length: 1270 }, (_, i) => ev(`e${i}`, `${1990 + Math.floor(i / 40)}-${String((i % 12) + 1).padStart(2, '0')}-10`, 'PAH'))
    const { container } = renderTrack({ list: many })
    const n = container.querySelectorAll('[data-card]').length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(13)
  })

  it('jumps to an event (id with ":" and "/") and flashes it; unknown ids report false', () => {
    const { container, ref } = renderTrack()
    let ok = false
    act(() => {
      ok = ref.current!.jump('ai:trep:https://x.org/a/b:0')
    })
    expect(ok).toBe(true)
    expect(container.querySelector('[data-card="ai:trep:https://x.org/a/b:0"]')).toHaveClass('animate-journey-flash')
    expect(ref.current!.jump('nope')).toBe(false)
  })

  it('alternates cards above and below the band; starred cards show the star icon and no ring', () => {
    const { container } = renderTrack()
    const a = container.querySelector<HTMLElement>('[data-card="a"]')!
    const b = container.querySelector<HTMLElement>('[data-card="b"]')!
    expect(a.style.bottom).not.toBe('')
    expect(a.style.top).toBe('')
    expect(b.style.top).not.toBe('')
    expect(b.style.bottom).toBe('')
    expect(a.querySelector('[aria-label="Starred"]')).toBeInTheDocument()
    expect(a.className).not.toContain('inset_0_0_0_2px')
    expect(a.className).toContain('hover:border-[#c7d1f4]')
    expect(a.className).toContain('shadow-[0_14px_34px_rgba(35,71,217,0.13)]')
    expect(a.className).not.toMatch(/shadow-panel|hover:shadow-card-hover/)
    expect(b.className).toContain('shadow-panel')
    expect(b.style.transitionDelay).toBe('60ms, 60ms, 0ms, 0ms')
  })

  it('fades a pinned label until its lane starts within 0.75 of the viewport', () => {
    const list = [...Array.from({ length: 9 }, (_, i) => ev(`p${i}`, `${2000 + i}-03-01`, 'PAH')), ev('c1', '2012-03-01', 'CTEPH'), ev('c2', '2013-03-01', 'CTEPH')]
    const { container } = renderTrack({ list, closures: {}, stars: [], comments: {} })
    expect(container.querySelector('[data-row="PAH"]')).toHaveClass('opacity-100')
    expect(container.querySelector('[data-row="CTEPH"]')).toHaveClass('opacity-45')
    expect(container.querySelector('[data-row="CTEPH"]')).toHaveTextContent('from 2012')
    expect(container.querySelector('[data-row="PPF"]')).not.toBeInTheDocument()
  })

  it('draws the HUD inside the pinned track, naming the active event and its position', () => {
    const { container } = renderTrack()
    const hud = screen.getByTestId('journey-hud')
    expect(container.querySelector('[data-testid="journey-horizontal"]')).toContainElement(hud)
    expect(hud).toHaveAttribute('aria-hidden', 'true')
    expect(hud).toHaveTextContent(`01/${String(LIST.length).padStart(2, '0')}`)
  })

  it('keeps the background years visible but static under reduced motion', () => {
    const { container } = renderTrack()
    const bg = container.querySelector<HTMLElement>('[data-testid="journey-horizontal"] [aria-hidden="true"].will-change-transform')!
    expect(bg.textContent).toMatch(/\d{4}/)
    expect(bg.style.transform).toBe('')
  })

  it('moves the rendered window and track when the page scrolls', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ev(`m${i}`, `${1990 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-10`, 'PAH'))
    const { container } = renderTrack({ list: many, closures: {}, stars: [], comments: {} })
    expect(container.querySelector('[data-card="m0"]')).toBeInTheDocument()
    expect(container.querySelector('[data-card="m100"]')).not.toBeInTheDocument()
    const top = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.dataset.testid === 'journey-horizontal' ? -236 - 100 * 178 : 0 } as DOMRect
    })
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    await waitFor(() => expect(container.querySelector('[data-card="m100"]')).toBeInTheDocument())
    expect(container.querySelector('[data-card="m0"]')).not.toBeInTheDocument()
    expect(container.querySelector('svg')!.parentElement!.style.transform).toMatch(/translateX\(-\d+/)
    top.mockRestore()
  })

  it('draws a lane, not nothing, for an asset with no branches', () => {
    const model = branchModel([])
    const list = [ev('x', '2010-01-05', 'PAH'), ev('y', '2012-03-09', 'PAH')]
    const { container } = renderTrack({ list, model, closures: {}, stars: [], comments: {} })
    expect(container.querySelectorAll('[data-lane]')).toHaveLength(1)
    expect(container.querySelector('[data-row]')).toHaveTextContent('Journey')
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2)
    expect(container.innerHTML).not.toMatch(/NaN/)
  })
})
