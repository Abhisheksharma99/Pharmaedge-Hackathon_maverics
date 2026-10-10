import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { JourneyEventV3 } from '../types'
import { TreeCard, type TreeCardProps } from './tree-card'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const LINKED: JourneyEventV3 = { id: 'rule:fda:x/1', asset: 'trep', date: '2025-09-30', type: 'regulatory_submission', category: 'regulatory', title: 'FDA accepts Tyvaso sNDA for IPF', significance: 'High', is_milestone: false, sources: [], via: 'journey' }
const NONKEY: JourneyEventV3 = { ...LINKED, id: 'rule:trial_completion:ctgov:NCT04708782', title: 'TETON-1 completed', date: '2025-01-01' }
const E: JourneyEventV3 = {
  id: 'rule:trial_start:ctgov:NCT04708782', asset: 'trep', date: '2021-06-01', type: 'trial_start', category: 'clinical', title: 'Phase 3 trial started: TETON-1',
  summary: 'Inhaled treprostinil in IPF.', significance: 'High', is_milestone: false, via: 'journey', branch: 'IPF',
  sources: [{ collection: 'trial_records', record_key: 'ctgov:NCT04708782' }],
  indications: ['IPF'], product: 'Tyvaso', details: { Trial: 'NCT04708782', Phase: 'Phase 3', Enrollment: '~600 (target)', 'Primary endpoint': 'Change in FVC at week 52', Status: 'Active' },
  impact: 'Moves treprostinil from vascular to fibrotic lung disease.', links: [LINKED.id, NONKEY.id],
}

function Harness(over: Partial<TreeCardProps>) {
  const [open, setOpen] = useState(false)
  return (
    <TreeCard
      assetId="trep" e={E} open={open} onToggle={() => setOpen(!open)} starred={false} nComments={2}
      onStar={vi.fn()} onOpen={vi.fn()} onJump={vi.fn()} resolve={(id) => (id === LINKED.id ? LINKED : undefined)} {...over}
    />
  )
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => json(200, { events: [E, LINKED, NONKEY], total: 3 }))))
afterEach(() => vi.unstubAllGlobals())
const renderCard = (over: Partial<TreeCardProps> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness {...over} />
    </QueryClientProvider>,
  )

describe('TreeCard', () => {
  it('shows category, indication, date, significance, targets, details, why it matters and how it was built', () => {
    renderCard()
    expect(screen.getByText('Clinical')).toBeInTheDocument()
    expect(screen.getByText('trial start')).toBeInTheDocument()
    expect(screen.getAllByText('IPF')).toHaveLength(2)
    expect(screen.getByTitle('Indication: IPF')).toBeInTheDocument()
    expect(screen.getByText('Jun 1, 2021')).toBeInTheDocument()
    expect(screen.getByText('Tyvaso')).toBeInTheDocument()
    expect(screen.getByText('Change in FVC at week 52')).toBeInTheDocument()
    expect(screen.getByText('Moves treprostinil from vascular to fibrotic lung disease.')).toBeInTheDocument()
    expect(screen.getByText('Rule · trial_records')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comments (2)' })).toHaveTextContent('2')
  })

  it('stars, opens details from the title, comments and Details', async () => {
    const onStar = vi.fn()
    const onOpen = vi.fn()
    renderCard({ onStar, onOpen, starred: true })
    await userEvent.click(screen.getByRole('button', { name: 'Mark as important' }))
    expect(onStar).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Mark as important' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Phase 3 trial started: TETON-1' }))
    await userEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('opens the subtree with the record, its facts, the indications and every linked event, and jumps to one', async () => {
    const onJump = vi.fn()
    renderCard({ onJump })
    await userEvent.click(screen.getByRole('button', { name: /Subtree/ }))
    const tree = screen.getByRole('list', { name: 'Subtree' })
    expect(within(tree).getByText('ctgov:NCT04708782')).toBeInTheDocument()
    expect(within(tree).getByText('Primary endpoint')).toBeInTheDocument()
    expect(within(tree).getByText('Indications')).toBeInTheDocument()
    // The non-key linked event is looked up in "All" once the subtree opens.
    expect(await within(tree).findByText('TETON-1 completed')).toBeInTheDocument()
    await userEvent.click(within(tree).getByRole('button', { name: /FDA accepts Tyvaso sNDA for IPF/ }))
    expect(onJump).toHaveBeenCalledWith(LINKED.id)
    expect(screen.getByRole('button', { name: /Hide subtree/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
