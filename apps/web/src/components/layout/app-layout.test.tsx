import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider, type User } from '@/features/auth/auth-context'
import type { EventDetail } from '@/features/journey/api'
import { routes } from '@/routes'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useShellStore } from '@/stores/shell-store'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const USER: User = { id: '1', email: 'ana@x.com', name: 'Ana Analyst', role: 'analyst', active: true, createdAt: '' }
const EVENT_ID = 'rule:start:NCT04708782'
const DETAIL: EventDetail = {
  event: {
    id: EVENT_ID,
    asset: 'trep',
    date: '2021-06-01',
    type: 'trial_start',
    category: 'clinical',
    title: 'Phase 3 trial started: TETON-1',
    significance: 'High',
    is_milestone: false,
    sources: [],
    via: 'journey',
  },
  records: [],
  neighbors: { prev: null, next: null },
  branchStats: { index: 1, total: 1, prevSameBranch: null },
}

function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { user: USER })
      if (url === '/api/assets') return json(200, [])
      if (url.startsWith('/api/search?q=')) {
        return json(200, { assets: [], events: [{ id: EVENT_ID, asset: 'trep', assetName: 'Treprostinil', title: DETAIL.event.title, date: '2021-06-01', category: 'clinical', nct_id: 'NCT04708782' }] })
      }
      if (url === `/api/assets/trep/events/${encodeURIComponent(EVENT_ID)}`) return json(200, DETAIL)
      return json(404, { code: 'NOT_FOUND', message: url })
    }),
  )
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  useShellStore.setState({ paletteOpen: false, mobileNavOpen: false })
  useEventSheet.setState({ current: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('AppLayout', () => {
  it('toggles the command palette with ⌘K and Ctrl+K on any page', async () => {
    fakeApi()
    renderAt('/uploads')
    await screen.findByText('Coming soon')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Search PharmaEdge' })).toBeInTheDocument()
    await userEvent.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search PharmaEdge' })).not.toBeInTheDocument())
    expect(useShellStore.getState().paletteOpen).toBe(false)
  })

  it('opens the event sheet for an event picked in the palette', async () => {
    fakeApi()
    renderAt('/uploads')
    await screen.findByText('Coming soon')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(await screen.findByRole('combobox', { name: 'Search PharmaEdge' }), 'TETON')
    await screen.findByRole('option', { name: /Phase 3 trial started: TETON-1/ })
    await userEvent.keyboard('{Enter}')
    const sheet = await screen.findByRole('dialog', { name: 'Phase 3 trial started: TETON-1' })
    expect(within(sheet).getByRole('button', { name: 'Show on the journey timeline' })).toBeInTheDocument()
  })

  it('returns focus to the element that had it when the palette closes', async () => {
    fakeApi()
    renderAt('/uploads')
    await screen.findByText('Coming soon')
    const button = document.body.appendChild(document.createElement('button'))
    button.textContent = 'Opener'
    button.focus()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog', { name: 'Search PharmaEdge' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search PharmaEdge' })).not.toBeInTheDocument())
    expect(button).toHaveFocus()
    button.remove()
  })

  it('returns focus to the element that had it when the event sheet closes', async () => {
    fakeApi()
    renderAt('/uploads')
    await screen.findByText('Coming soon')
    const button = document.body.appendChild(document.createElement('button'))
    button.textContent = 'Opener'
    button.focus()
    act(() => useEventSheet.getState().openEvent('trep', EVENT_ID))
    await screen.findByRole('dialog', { name: 'Phase 3 trial started: TETON-1' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveFocus()
    button.remove()
  })

  it('returns focus to the original element when the sheet was opened from the palette', async () => {
    fakeApi()
    renderAt('/uploads')
    await screen.findByText('Coming soon')
    const button = document.body.appendChild(document.createElement('button'))
    button.textContent = 'Opener'
    button.focus()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    await userEvent.type(await screen.findByRole('combobox', { name: 'Search PharmaEdge' }), 'TETON')
    await screen.findByRole('option', { name: /Phase 3 trial started: TETON-1/ })
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'Phase 3 trial started: TETON-1' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveFocus()
    button.remove()
  })

  it('ignores key repeat on ⌘K', async () => {
    fakeApi()
    renderAt('/uploads')
    await screen.findByText('Coming soon')
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    await screen.findByRole('dialog', { name: 'Search PharmaEdge' })
    fireEvent.keyDown(window, { key: 'k', metaKey: true, repeat: true })
    expect(useShellStore.getState().paletteOpen).toBe(true)
  })
})
