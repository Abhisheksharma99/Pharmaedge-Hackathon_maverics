import { render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { JourneyEventV3 } from '@/features/journey/types'
import type { AssetSummary } from '../api'
import { AssetCard, AssetStatusPill } from './asset-card'

const ZERO = { trials: 0, regulatory: 0, pressReleases: 0, documents: 0, news: 0, publications: 0, conferences: 0, patents: 0, events: 0 }
const TREP: AssetSummary = {
  id: 'trep',
  name: 'Treprostinil',
  aliases: ['Tyvaso', 'Remodulin'],
  company: { name: 'United Therapeutics' },
  tags: { indications: ['PAH'], investigational_indications: ['IPF'] },
  kind: 'primary',
  status: 'ready',
  updatedAt: null,
  counts: { ...ZERO, trials: 74, events: 909 },
  latestEvent: { date: '2026-10-05', title: 'Study highlights inhaled treprostinil in IPF', type: 'publication' },
  competitorOf: [],
}
const NINT: AssetSummary = {
  ...TREP,
  id: 'nint',
  name: 'Nintedanib',
  aliases: ['Ofev'],
  company: { name: 'Boehringer Ingelheim' },
  tags: { indications: ['IPF', 'PPF'] },
  kind: 'competitor',
  counts: ZERO,
  latestEvent: null,
  competitorOf: [{ id: 'trep', name: 'Treprostinil' }],
}
const ev = (id: string, date: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date,
  type: 'approval',
  category: 'regulatory',
  title: id,
  significance: 'High',
  is_milestone: false,
  sources: [],
  via: 'journey',
  ...extra,
})
const EVENTS = [ev('a', '2026-02-01'), ev('b', '2026-05-01'), ev('c', '2024-03-01'), ev('m', '2026-12-01', { is_milestone: true }), ev('n', '2027-06-01', { is_milestone: true })]

const wrap = (ui: ReactElement) =>
  render(
    <TooltipProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </TooltipProvider>,
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('AssetCard', () => {
  it('home: brand and company, regions, indications, sparkline, latest event and footer', () => {
    wrap(<AssetCard asset={TREP} events={EVENTS} progress={null} regions={['US', 'EU']} competitors={1} variant="home" />)
    const card = screen.getByRole('link', { name: /Treprostinil/ })
    expect(card).toHaveAttribute('href', '/assets/trep/overview')
    expect(card).toHaveTextContent('Tyvaso · United Therapeutics')
    expect(card).toHaveTextContent('US, EU')
    expect(within(card).getByText('IPF')).toHaveClass('border-dashed')
    expect(card).toHaveTextContent('Study highlights inhaled treprostinil in IPF')
    expect(card).toHaveTextContent('909 events')
    expect(card).toHaveTextContent('74 trials')
    expect(card).toHaveTextContent('1 competitor')
    expect(card).toHaveTextContent('in 2 months')
    const spark = within(card).getByRole('img', { name: 'Key events per year, 2015–2027' })
    expect(spark.querySelectorAll('rect')).toHaveLength(13)
    expect(spark.querySelector('[data-year="2026"]')).toHaveAttribute('data-count', '3')
    expect(spark.querySelector('[data-year="2024"]')).toHaveAttribute('data-count', '1')
    expect(spark.querySelector('[data-year="2027"]')).toHaveAttribute('data-count', '1')
  })

  it('search: kind badge, rivals, company only, Ready', () => {
    wrap(<AssetCard asset={NINT} events={[]} progress={null} variant="search" />)
    const card = screen.getByRole('link', { name: /Nintedanib/ })
    expect(within(card).getByText('Competitor')).toBeInTheDocument()
    expect(card).toHaveTextContent('vs Treprostinil')
    expect(card).toHaveTextContent('Boehringer Ingelheim')
    expect(card).not.toHaveTextContent('Ofev ·')
    expect(card).toHaveTextContent('Ready')
    expect(card).toHaveTextContent('Latest—')
  })
})

describe('AssetStatusPill', () => {
  it('reads the crawl state', () => {
    const { rerender } = wrap(<AssetStatusPill asset={{ status: 'ready' }} progress={0.5} variant="search" />)
    expect(screen.getByText('Collecting · 50%')).toBeInTheDocument()
    rerender(<AssetStatusPill asset={{ status: 'ready' }} progress={0.5} variant="home" />)
    expect(screen.getByText('50%')).toBeInTheDocument()
    rerender(<AssetStatusPill asset={{ status: 'onboarding' }} progress={null} variant="search" />)
    expect(screen.getByText('Collecting')).toBeInTheDocument()
    rerender(<AssetStatusPill asset={{ status: 'failed' }} progress={null} variant="search" />)
    expect(screen.getByText('Collection failed')).toBeInTheDocument()
    rerender(<AssetStatusPill asset={{ status: 'ready' }} progress={null} regions={[]} variant="home" />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })
})
