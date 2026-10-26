import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { useEventSheet } from '@/stores/event-sheet-store'
import { JourneySection } from './journey-section'
import type { JourneyEventV3 } from './types'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ev = (id: string, date: string): JourneyEventV3 => ({
  id, asset: 'trep', date, branch: 'PAH', type: 'approval', category: 'regulatory', title: `Event ${id}`, significance: 'Low', is_milestone: false, sources: [], via: 'journey', key: true,
})
const KEY = [ev('a', '2002-05-21'), ev('b', '2017-02-01'), ev('c', '2018-05-08')]

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/journey/:assetId', element: <JourneySection asset={{ id: 'trep', name: 'Treprostinil' }} /> }], { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  return router
}

const param = (router: ReturnType<typeof renderAt>, k: string) => new URLSearchParams(router.state.location.search).get(k)
const focusedCard = () => document.activeElement?.getAttribute('data-card')

beforeEach(() => {
  useEventSheet.setState({ current: null, journeyAsset: null, locate: null })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/assets/trep/timeline?scope=')) return json(200, { events: [...KEY].reverse(), total: KEY.length })
      if (url === '/api/assets/trep/branches') return json(200, [])
      if (url === '/api/assets/trep/annotations') return json(200, { stars: [], comments: {}, notes: [] })
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('journey keyboard shortcuts', () => {
  it('→ / ← and j / k move between the cards (roving focus); Enter opens the focused event', async () => {
    const user = userEvent.setup()
    renderAt('/journey/trep')
    await screen.findByTestId('journey-horizontal')
    // From elsewhere in the journey, the first step focuses the active card.
    screen.getByRole('button', { name: 'Horizontal' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toHaveAttribute('data-card')
    expect(document.activeElement).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight J K Enter')
    // From a focused card, steps move along the track.
    ;(document.querySelector('[data-card="a"]') as HTMLElement).focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(focusedCard()).toBe('b'))
    await user.keyboard('j')
    await waitFor(() => expect(focusedCard()).toBe('c'))
    await user.keyboard('j') // stays on the last
    expect(focusedCard()).toBe('c')
    await user.keyboard('k')
    await waitFor(() => expect(focusedCard()).toBe('b'))
    // Only the active card is in the tab order.
    expect(document.querySelectorAll('[data-card][tabindex="0"]')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'b' })
  })

  it('switches orientation (h / v) and order (n), and moves through the vertical tree too', async () => {
    const user = userEvent.setup()
    const router = renderAt('/journey/trep')
    await screen.findByTestId('journey-horizontal')
    await user.keyboard('v')
    expect(await screen.findByTestId('journey-tree')).toBeInTheDocument()
    expect(param(router, 'view')).toBe('v')
    // From elsewhere in the journey, the first step focuses a card's title (it opens the event on Enter).
    screen.getByRole('button', { name: 'Vertical' }).focus()
    await user.keyboard('j')
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight J K Enter'))
    screen.getByRole('button', { name: 'Event a' }).focus()
    await user.keyboard('j')
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Event b'))
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Event a'))
    await user.keyboard('{Enter}')
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: 'a' })
    useEventSheet.setState({ current: null })
    await user.keyboard('n')
    expect(param(router, 'order')).toBe('newest')
    await user.keyboard('n')
    expect(param(router, 'order')).toBeNull()
    await user.keyboard('h')
    expect(await screen.findByTestId('journey-horizontal')).toBeInTheDocument()
    expect(param(router, 'view')).toBeNull()
  })

  it('"/" focuses the title search (showing hidden filters); keys typed there never switch the journey', async () => {
    const user = userEvent.setup()
    const router = renderAt('/journey/trep')
    await screen.findByTestId('journey-horizontal')
    await user.click(screen.getByRole('button', { name: /Hide filters/ }))
    expect(screen.queryByRole('searchbox', { name: 'Search event titles' })).not.toBeInTheDocument()
    await user.keyboard('/')
    const search = screen.getByRole('searchbox', { name: 'Search event titles' })
    expect(search).toHaveFocus()
    expect(search).toHaveAttribute('aria-keyshortcuts', '/')
    await user.keyboard('vnh?jk')
    expect(search).toHaveValue('vnh?jk')
    expect(param(router, 'q')).toBe('vnh?jk')
    expect(param(router, 'view')).toBeNull()
    expect(param(router, 'order')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"?" opens the shortcuts; Esc closes them', async () => {
    const user = userEvent.setup()
    renderAt('/journey/trep')
    await screen.findByTestId('journey-horizontal')
    await user.keyboard('?')
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(dialog).getByText('Next event')).toBeInTheDocument()
    // Keys inside the dialog belong to it.
    await user.keyboard('v')
    expect(screen.getByTestId('journey-horizontal')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-keyshortcuts', '?')
  })
})

describe('Copy link', () => {
  it('copies the journey URL with its view, order, scope, filters and branch, without a one-off focus', async () => {
    const user = userEvent.setup()
    renderAt('/journey/trep?view=v&order=newest&scope=all&cat=clinical&ind=PAH&q=tyvaso&branch=PH-ILD')
    await screen.findByText('No events match these filters')
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText('Link copied')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/journey/trep?view=v&order=newest&scope=all&cat=clinical&ind=PAH&q=tyvaso&branch=PH-ILD`)
  })
})
