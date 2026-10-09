import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Mock } from 'vitest'
import type { Identity } from '../../api'
import { IdentityCard } from './identity-card'

const IDENTITY: Identity = {
  id: 'sotatercept',
  name: 'Sotatercept',
  aliases: ['Winrevair', 'MK-7962'],
  company: { name: 'Merck & Co.', website: 'https://www.merck.com', ir_url: 'https://www.merck.com/media/news/' },
  website_verified: true,
  ir_verified: false,
  tags: {
    indications: ['Pulmonary arterial hypertension (PAH)'],
    investigational_indications: [],
    mechanism: 'Activin signaling inhibitor',
    modality: 'Biologic',
  },
  sources: { fda: 1, ema: 1, trials: 23 },
  exists: false,
  existing: null,
  plan: [
    { name: 'regulatory', label: 'Regulatory (FDA, EMA)', note: '' },
    { name: 'clinical', label: 'Clinical trials', note: '23 trials' },
  ],
  plan_summary: 'FDA + EMA, 23 trials, PubMed, Merck newsroom',
  notes: ['No AdisInsight id: patents are searched by name and company'],
}

const json = (status: number, body?: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function renderCard(identity: Identity, crawlStarted = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <IdentityCard identity={identity} sessionId="s1" crawlStarted={crawlStarted} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { invalidate }
}

describe('IdentityCard', () => {
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>
  beforeEach(() => {
    fetchMock = vi.fn(async () => json(201, { asset: { id: 'sotatercept' }, job: { id: 'j1' } }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows what was found and the crawl plan', async () => {
    renderCard(IDENTITY)
    expect(screen.getByText('Also known as Winrevair, MK-7962')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'merck.com' })).toHaveAttribute('href', 'https://www.merck.com')
    expect(screen.getByLabelText('Verified')).toBeInTheDocument()
    expect(screen.getByText('FDA 1 · EMA 1 · Trials 23')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /2 steps/ }))
    expect(screen.getByText('Clinical trials')).toBeInTheDocument()
  })

  it('posts the edited identity with the chat session, then refreshes the chat', async () => {
    const { invalidate } = renderCard(IDENTITY)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Sotatercept-csrk')
    const aliases = screen.getByLabelText(/^Aliases/)
    await userEvent.clear(aliases)
    await userEvent.type(aliases, 'Winrevair,  MK-7962, ACE-011 ,')
    await userEvent.clear(screen.getByLabelText('IR page URL'))
    await userEvent.type(screen.getByLabelText(/^Investigational indications/), 'Heart failure')

    await userEvent.click(screen.getByRole('button', { name: 'Confirm & start crawl' }))

    expect(await screen.findByText('Crawl started')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/assets')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({
      name: 'Sotatercept-csrk',
      aliases: ['Winrevair', 'MK-7962', 'ACE-011'],
      company: { name: 'Merck & Co.', website: 'https://www.merck.com' },
      tags: {
        indications: ['Pulmonary arterial hypertension (PAH)'],
        investigational_indications: ['Heart failure'],
        mechanism: 'Activin signaling inhibitor',
        modality: 'Biologic',
      },
      chatSessionId: 's1',
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat', 'messages', 's1'] })
  })

  it('shows the server message when the asset already exists', async () => {
    fetchMock.mockResolvedValue(json(409, { code: 'ASSET_EXISTS', message: 'Sotatercept is already tracked' }))
    renderCard(IDENTITY)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm & start crawl' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sotatercept is already tracked')
  })

  it('links to an asset that is already tracked instead of offering a crawl', () => {
    renderCard({ ...IDENTITY, exists: true, existing: { id: 'sotatercept', kind: 'primary', status: 'ready' } })
    expect(screen.getByText('Already tracked')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open asset/ })).toHaveAttribute('href', '/assets/sotatercept/overview')
    expect(screen.queryByRole('button', { name: 'Confirm & start crawl' })).not.toBeInTheDocument()
  })

  it('is done once the chat has the crawl job for it', () => {
    renderCard(IDENTITY, true)
    expect(screen.getByText('Crawl started')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm & start crawl' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('offers to track a competitor asset fully', () => {
    renderCard({ ...IDENTITY, exists: true, existing: { id: 'sotatercept', kind: 'competitor', status: 'ready' } })
    expect(screen.getByRole('button', { name: 'Track fully' })).toBeInTheDocument()
  })
})
