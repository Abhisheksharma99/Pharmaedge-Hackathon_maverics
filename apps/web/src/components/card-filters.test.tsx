import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardFilters, useCardFilter } from './card-filters'

const ITEMS = [
  { name: 'Tyvaso', ind: ['PAH'] },
  { name: 'Remodulin', ind: ['PAH'] },
  { name: 'Ofev', ind: ['IPF'] },
]

function Card({ collapseKey = 'test.card', defaultCollapsed }: { collapseKey?: string; defaultCollapsed?: boolean }) {
  const { filtered, filters } = useCardFilter(ITEMS, (i) => i.name, [{ label: 'Indication', of: (i) => i.ind }])
  return (
    <>
      <CardFilters {...filters} collapseKey={collapseKey} defaultCollapsed={defaultCollapsed} placeholder="Search drugs" />
      <ul aria-label="Drugs">
        {filtered.map((i) => (
          <li key={i.name}>{i.name}</li>
        ))}
      </ul>
    </>
  )
}

const shown = () => screen.getAllByRole('listitem').map((li) => li.textContent)

describe('CardFilters hide/show', () => {
  it('hides the bar behind a Filters chip that controls it, and shows it again', async () => {
    render(<Card />)
    const hide = screen.getByRole('button', { name: 'Hide filters' })
    expect(hide).toHaveAttribute('aria-expanded', 'true')
    const bar = document.getElementById(hide.getAttribute('aria-controls')!)!
    expect(bar).toContainElement(screen.getByRole('searchbox', { name: 'Search drugs' }))
    await userEvent.click(hide)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(bar).not.toBeVisible()
    const show = screen.getByRole('button', { name: 'Show filters' })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    // One button for both states: keyboard focus stays on it.
    expect(show).toBe(hide)
    expect(show).toHaveFocus()
    await userEvent.click(show)
    expect(screen.getByRole('searchbox', { name: 'Search drugs' })).toBeVisible()
  })

  it('keeps the filters applied while hidden, with their count, n of m and a quick Clear', async () => {
    render(<Card />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search drugs' }), 'o')
    await userEvent.click(screen.getByRole('combobox', { name: 'Indication' }))
    await userEvent.click(await screen.findByRole('option', { name: 'PAH' }))
    expect(shown()).toEqual(['Tyvaso', 'Remodulin'])
    await userEvent.click(screen.getByRole('button', { name: 'Hide filters' }))
    expect(shown()).toEqual(['Tyvaso', 'Remodulin'])
    expect(screen.getByRole('button', { name: 'Show filters (2 active)' })).toHaveTextContent('Filters2')
    expect(screen.getByText('2 of 3')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(shown()).toEqual(['Tyvaso', 'Remodulin', 'Ofev'])
    expect(screen.getByRole('button', { name: 'Show filters' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('remembers the choice per bar and can start hidden', async () => {
    const { unmount } = render(<Card />)
    await userEvent.click(screen.getByRole('button', { name: 'Hide filters' }))
    unmount()
    render(<Card />)
    expect(screen.getByRole('button', { name: 'Show filters' })).toBeInTheDocument()
    render(<Card collapseKey="test.other" />)
    expect(screen.getByRole('button', { name: 'Hide filters' })).toBeInTheDocument()
  })

  it('starts hidden when asked to, until the bar is opened', async () => {
    const { unmount } = render(<Card defaultCollapsed />)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    unmount()
    render(<Card defaultCollapsed />)
    expect(screen.getByRole('searchbox', { name: 'Search drugs' })).toBeVisible()
  })

  it('still works when storage is blocked', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<Card />)
    await userEvent.click(screen.getByRole('button', { name: 'Hide filters' }))
    expect(screen.getByRole('button', { name: 'Show filters' })).toBeInTheDocument()
    get.mockRestore()
    set.mockRestore()
  })
})

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})
