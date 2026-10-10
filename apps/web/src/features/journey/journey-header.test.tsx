import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { JourneyHeader, type JourneyHeaderProps } from './journey-header'
import { branchModel, journeyCounts } from './journey-model'
import type { Branch, JourneyEventV3 } from './types'

const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra })
const ev = (id: string, date: string, branch: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, branch, type: 'approval', category: 'regulatory', title: id, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const MODEL = branchModel([br('PAH', 0, { trunk: true }), br('PH-ILD', 1, { from: 'PAH' }), br('PH-COPD', -1, { from: 'PAH', ended: 'Terminated', status: 'Closed · PERFECT terminated' }), br('SSc', 2, { from: 'PAH' })])
const LIST = [ev('a', '2002-05-21', 'PAH'), ev('b', '2017-02-01', 'PH-ILD', { category: 'clinical' }), ev('c', '2018-05-08', 'PH-COPD', { via: 'user' }), ev('d', '2028-01-01', 'PH-ILD')]

function setup(over: Partial<JourneyHeaderProps> = {}) {
  const props: JourneyHeaderProps = {
    assetId: 'trep', model: MODEL, list: LIST, undated: 0, counts: journeyCounts(LIST, ['a']), view: 'h', order: 'oldest', scope: 'key', cats: [], mine: null,
    indications: ['PAH', 'PH-COPD', 'PH-ILD'], ind: null, q: '', focusBranch: null,
    onView: vi.fn(), onOrder: vi.fn(), onScope: vi.fn(), onToggleCat: vi.fn(), onMine: vi.fn(), onInd: vi.fn(), onQuery: vi.fn(), onFocusBranch: vi.fn(), onClear: vi.fn(), onAdd: vi.fn(), ...over,
  }
  const router = createMemoryRouter([{ path: '*', element: <JourneyHeader {...props} /> }], { initialEntries: ['/journey/trep'] })
  render(<RouterProvider router={router} />)
  return { props, router }
}

// Radix Select uses pointer capture, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})

describe('JourneyHeader', () => {
  it('summarises the journey and links to how it was built', () => {
    const { router } = setup({ undated: 2 })
    expect(screen.getByText(/^4 events, 2002–2028 · 3 indication branches\. Each new indication forks off/)).toHaveTextContent('2 undated events are not placed on the timeline.')
    // From the Asset Journey page too, the build lives on the asset's Overview.
    expect(screen.getByRole('link', { name: 'How this journey was built' })).toHaveAttribute('href', '/assets/trep/overview?build=1')
    expect(router.state.location.pathname).toBe('/journey/trep')
  })

  it('shows a card per branch with its parent, count, status and first year; empty branches are disabled', async () => {
    const { props } = setup()
    const copd = screen.getByRole('button', { name: /PH-COPD/ })
    expect(copd).toHaveTextContent('PH-COPDfrom PAH1PH-COPD fullClosed · PERFECT terminated · since 2018')
    expect(within(copd).getByText(/Closed/)).toHaveClass('text-warning')
    expect(screen.getByRole('button', { name: /^PAH/ })).toHaveTextContent('Trunk')
    expect(screen.getByRole('button', { name: /SSc/ })).toBeDisabled()
    await userEvent.click(copd)
    expect(props.onFocusBranch).toHaveBeenCalledWith('PH-COPD')
  })

  it('offers Horizontal | Vertical (horizontal first) and Oldest | Newest first', async () => {
    const { props } = setup()
    const orientation = within(screen.getByRole('group', { name: 'Orientation' })).getAllByRole('button')
    expect(orientation.map((b) => b.textContent)).toEqual(['Horizontal', 'Vertical'])
    expect(orientation[0]).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(orientation[1]!)
    expect(props.onView).toHaveBeenCalledWith('v')
    const order = within(screen.getByRole('group', { name: 'Order' })).getAllByRole('button')
    expect(order.map((b) => b.textContent)).toEqual(['Oldest first', 'Newest first'])
    expect(order[0]).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(order[1]!)
    expect(props.onOrder).toHaveBeenCalledWith('newest')
  })

  it('filters by indication and title; either shows Clear', async () => {
    const { props } = setup()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: 'Indication' }))
    await userEvent.click(await screen.findByRole('option', { name: 'PH-ILD' }))
    expect(props.onInd).toHaveBeenCalledWith('PH-ILD')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search event titles' }), 'ab')
    expect(props.onQuery).toHaveBeenLastCalledWith('ab')
  })

  it('shows the picked indication and the search from the URL', () => {
    setup({ ind: 'PAH', q: 'tyvaso' })
    expect(screen.getByRole('combobox', { name: 'Indication' })).toHaveTextContent('PAH')
    expect(screen.getByRole('searchbox', { name: 'Search event titles' })).toHaveValue('tyvaso')
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('switches scope, filters by category / starred / team notes, and clears', async () => {
    const { props } = setup({ cats: ['clinical'] })
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(props.onScope).toHaveBeenCalledWith('all')
    const filters = within(screen.getByRole('group', { name: 'Filter the journey' }))
    expect(filters.getByRole('button', { name: /Clinical/ })).toHaveAttribute('aria-pressed', 'true')
    expect(filters.getByRole('button', { name: /Regulatory/ })).toHaveTextContent('Regulatory3')
    await userEvent.click(filters.getByRole('button', { name: /Patents/ }))
    expect(props.onToggleCat).toHaveBeenCalledWith('ip')
    expect(filters.getByRole('button', { name: /Starred/ })).toHaveTextContent('Starred1')
    await userEvent.click(filters.getByRole('button', { name: /Team notes/ }))
    expect(props.onMine).toHaveBeenCalledWith('notes')
    await userEvent.click(filters.getByRole('button', { name: 'Clear' }))
    expect(props.onClear).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Add to timeline' }))
    expect(props.onAdd).toHaveBeenCalled()
  })

  it('has no branch cards or branch count on a single-trunk journey', () => {
    setup({ model: branchModel([]) })
    expect(screen.getByText(/^4 events, 2002–2028\. Open a card’s subtree/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trunk/ })).not.toBeInTheDocument()
  })
})

describe('Segmented variants', () => {
  it('uses the prototype toggle metrics for both variants', async () => {
    const { Segmented } = await import('@/features/assets/components/segmented')
    const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
    render(<><Segmented label="d" value="a" onChange={() => {}} options={opts} /><Segmented variant="compact" label="c" value="a" onChange={() => {}} options={opts} /></>)
    for (const name of ['d', 'c']) {
      expect(screen.getByRole('group', { name })).toHaveClass('rounded-[8px]', 'gap-[2px]', 'p-[2px]')
      const a = within(screen.getByRole('group', { name })).getByText('A')
      expect(a).toHaveClass('h-[28px]', 'rounded-[6px]', 'px-[10px]')
      expect(a).toHaveAttribute('aria-pressed', 'true')
    }
  })
})
