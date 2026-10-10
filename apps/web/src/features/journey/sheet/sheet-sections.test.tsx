import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EventRecord } from '../api'
import { branchModel } from '../journey-model'
import type { Branch, JourneyEventV3 } from '../types'
import { BranchLineage } from './branch-lineage'
import { PositionStrip } from './position-strip'
import { RecordTerms } from './record-terms'
import { RegulatoryPath } from './regulatory-path'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ev = (id: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id, asset: 'trep', date, type: 'approval', category: 'regulatory', title: `T ${id}`, significance: 'High', is_milestone: false, sources: [], via: 'journey', ...extra,
})
const br = (id: string, off: number, extra: Partial<Branch> = {}): Branch => ({ id, label: id, full: `${id} full`, color: '#0b7a6f', off, status: 'Approved · US', origin: 'ai', ...extra })
const rec = (extra: Partial<EventRecord>): EventRecord => ({ collection: 'fda_records', key: 'k', tab: 'regulatory', title: 't', date: '', url: null, record_type: null, source: null, ...extra })

describe('PositionStrip', () => {
  it('marks the event among the pool, counts its position and opens a dot', async () => {
    const onPick = vi.fn()
    const pool = [ev('a', '2002-05-21'), ev('b', '2017-02-01'), ev('c', '2028-01-01', { is_milestone: true })]
    const { container } = render(<PositionStrip event={pool[1]!} pool={pool} onPick={onPick} today="2026-10-09" />)
    expect(screen.getByText('#2 of 3')).toBeInTheDocument()
    expect(container.querySelector('[data-current]')).toHaveAttribute('r', '7')
    expect(container.innerHTML).not.toMatch(/NaN/)
    await userEvent.click(container.querySelector('[data-event="c"]')!)
    expect(onPick).toHaveBeenCalledWith('c')
  })

  it('jumps to any event from the single keyboard-reachable select (not one tab stop per dot)', async () => {
    const onPick = vi.fn()
    const pool = [ev('a', '2002-05-21'), ev('b', '2017-02-01')]
    const { container } = render(<PositionStrip event={pool[1]!} pool={pool} onPick={onPick} today="2026-10-09" />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    const select = screen.getByRole('combobox', { name: 'Jump to event' })
    expect(select).toHaveValue('b')
    expect(select).toHaveClass('sr-only')
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.selectOptions(select, '#1 · T a · 2002-05-21')
    expect(onPick).toHaveBeenCalledWith('a')
    onPick.mockClear()
    await userEvent.selectOptions(select, '#2 · T b · 2017-02-01')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('shows nothing for an undated event and ignores undated pool events in the count', () => {
    const pool = [ev('a', '2002-05-21'), ev('b', '2017-02-01'), ev('u', '')]
    const { container, rerender } = render(<PositionStrip event={ev('u', '')} pool={pool} onPick={() => {}} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<PositionStrip event={pool[1]!} pool={pool} onPick={() => {}} />)
    expect(screen.getByText('#2 of 2')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/NaN/)
  })

  it('adds the event when the pool does not have it and draws nothing for a lone event', () => {
    const { rerender } = render(<PositionStrip event={ev('x', '2010-01-01')} pool={[ev('a', '2002-05-21')]} onPick={() => {}} />)
    expect(screen.getByText('#2 of 2')).toBeInTheDocument()
    rerender(<PositionStrip event={ev('x', '2010-01-01')} pool={[]} onPick={() => {}} />)
    expect(screen.queryByText(/of/)).not.toBeInTheDocument()
  })
})

describe('BranchLineage', () => {
  const model = branchModel([br('PAH', 0, { trunk: true, color: '#2347d9' }), br('PH-ILD', 2, { from: 'PAH', full: 'PH due to interstitial lung disease' })])
  it('chains the branch from the trunk and says where the event sits on it', () => {
    render(
      <BranchLineage
        event={ev('e', '2021-03-31', { branch: 'PH-ILD' })}
        model={model}
        stats={{ index: 5, total: 8, prevSameBranch: { id: 'p', title: 'INCREASE results published in NEJM', date: '2021-01-12' } }}
      />,
    )
    expect(screen.getByText('PAH')).toBeInTheDocument()
    expect(screen.getByText('PH-ILD')).toHaveClass('shadow-[0_0_0_2px_currentColor]')
    expect(screen.getByText(/^PH due to interstitial lung disease · Approved · US\. Event 5 of 8 on this branch, 78 days after “INCREASE results published in NEJM”\.$/)).toBeInTheDocument()
  })

  it('shows nothing for a journey without branches', () => {
    const { container } = render(<BranchLineage event={ev('e', '2021-03-31')} model={branchModel([])} stats={{ index: 1, total: 1, prevSameBranch: null }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('RecordTerms', () => {
  it('draws the trial term with phase and enrolment, and the patent term with its status', () => {
    render(
      <RecordTerms
        color="#0b7a6f"
        product="Tyvaso"
        records={[
          rec({ collection: 'trial_records', tab: 'clinical', title: 'TETON-2 study', acronym: 'TETON-2', nct_id: 'NCT05255991', start_date: '2022-10-04', primary_completion_date: '2025-06-30', phases: ['PHASE3'], enrollment: 597, overall_status: 'COMPLETED', lead_sponsor: 'United Therapeutics' }),
          rec({ collection: 'patent_records', tab: 'patents', title: 'Prodrugs of treprostinil', publication_number: 'US11793780B2', grant_date: '2023-10-24', expiry_date: '2042-04-22', legal_status: 'Active', assignees: ['Mannkind Corp', 'United Therapeutics Corp'] }),
        ]}
      />,
    )
    const trial = screen.getByRole('region', { name: 'Trial · TETON-2' })
    expect(within(trial).getByText('Phase 3 · n=597')).toBeInTheDocument()
    expect(within(trial).getByText('TETON-2 study · Completed · United Therapeutics')).toBeInTheDocument()
    const patent = screen.getByRole('region', { name: 'Patent term · US11793780B2' })
    expect(within(patent).getByText('Active')).toBeInTheDocument()
    expect(within(patent).getByText('2042-04-22')).toBeInTheDocument()
    expect(within(patent).getByText('Prodrugs of treprostinil · covers Tyvaso')).toBeInTheDocument()
  })
})

describe('RegulatoryPath', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('lists every record of the application in date order with this event’s highlighted', async () => {
    const fetchMock = vi.fn(async () =>
      json(200, {
        items: [
          { key: 's17', application_number: 'NDA022387', date: '2021-03-31', submission_type: 'SUPPL', submission_number: '17', submission_class: 'Efficacy', submission_status: 'AP' },
          { key: 'orig', application_number: 'NDA022387', date: '2009-07-30', submission_type: 'ORIG', submission_number: '1', submission_status: 'AP' },
          { key: 'other', application_number: 'NDA022387X', date: '2010-01-01' },
        ],
        total: 3, page: 1, pageSize: 100,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RegulatoryPath assetId="trep" product="Tyvaso" records={[rec({ key: 's17', application_number: 'NDA022387' })]} />
      </QueryClientProvider>,
    )
    const path = await screen.findByRole('region', { name: 'Regulatory path · Tyvaso' })
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/trep/records/regulatory?q=NDA022387&pageSize=100', expect.anything())
    const steps = within(path).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual(['2009-07-30FDA submission · OriginalApproved', '2021-03-31FDA submission · EfficacyApproved'])
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
  })

  it('stays away when the event has no regulatory record', () => {
    const { container } = render(<RegulatoryPath assetId="trep" records={[rec({ collection: 'articles', tab: 'news' })]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('anchors on an EMA record, tones the statuses and notes truncation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, {
          items: [
            { key: 'e1', collection: 'ema_records', application_number: 'EMEA/H/C/1', date: '2010-01-01', submission_type: 'ORIG', submission_status: 'Under review' },
            { key: 'e2', collection: 'ema_records', application_number: 'EMEA/H/C/1', date: '2011-01-01', submission_status: 'Complete response' },
          ],
          total: 5, page: 1, pageSize: 2,
        }),
      ),
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RegulatoryPath assetId="trep" records={[rec({ collection: 'ema_records', key: 'e2', application_number: 'EMEA/H/C/1' })]} />
      </QueryClientProvider>,
    )
    const path = await screen.findByRole('region', { name: 'Regulatory path · EMEA/H/C/1' })
    expect(within(path).getByText('Under review')).toHaveClass('text-primary')
    expect(within(path).getByText('Complete response')).toHaveClass('text-destructive')
    expect(within(path).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step')
    expect(within(path).getByText('+3 more records not shown')).toBeInTheDocument()
  })
})
