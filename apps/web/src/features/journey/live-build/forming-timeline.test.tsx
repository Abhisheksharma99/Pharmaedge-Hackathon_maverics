import { fireEvent, render, screen } from '@testing-library/react'
import type { JourneyEventV3 } from '../types'
import { FormingTimeline } from './forming-timeline'
import { JustAdded } from './just-added'

const event = (id: string, extra: Partial<JourneyEventV3> = {}): JourneyEventV3 => ({
  id,
  asset: 'trep',
  date: '2021-04-01',
  type: 'approval',
  category: 'regulatory',
  title: `Event ${id}`,
  significance: 'High',
  is_milestone: false,
  sources: [{ collection: 'fda_records', record_key: 'NDA1' }],
  via: 'journey',
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T09:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('FormingTimeline', () => {
  it('lands record ticks and pops dated events on their lane, skipping the undated', () => {
    const years = [
      { coll: 'fda_records', year: 2021, n: 2 },
      { coll: 'trial_records', year: 2019, n: 1 },
    ]
    const events = [event('a'), event('b', { category: 'clinical', date: '2027-06-30', is_milestone: true }), event('c', { date: '' }), event('d', { date: '2020-02' })]
    const { container, rerender } = render(<FormingTimeline recordYears={years} recordCount={1234} events={events} />)
    expect(container.querySelectorAll('[data-tick]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-event]')).toHaveLength(3)
    expect(container.querySelector('[data-event="c"]')).toBeNull()
    expect(container.querySelector('[cx="NaN"]')).toBeNull()
    expect(container).toHaveTextContent('1,234')
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Regulatory')).toBeInTheDocument()

    // a later poll keeps the existing ticks (same keys, same elements) and adds the new one
    const first = container.querySelector('[data-tick]')
    rerender(<FormingTimeline recordYears={[{ ...years[0]!, n: 3 }, years[1]!]} recordCount={1235} events={events} />)
    expect(container.querySelectorAll('[data-tick]')).toHaveLength(4)
    expect(container.querySelector('[data-tick]')).toBe(first)
  })

  it('shows the title, date and origin of a hovered event', () => {
    const { container } = render(
      <FormingTimeline recordYears={[]} recordCount={0} events={[event('a', { via: 'ai_events', title: 'TETON-2 meets primary endpoint' })]} />,
    )
    fireEvent.mouseEnter(container.querySelector('[data-event="a"]')!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('TETON-2 meets primary endpointApr 1, 2021 · AI · 1 record')
    fireEvent.mouseLeave(container.querySelector('[data-event="a"]')!)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('JustAdded', () => {
  it('waits for the rules engine, and says when a finished crawl added nothing', () => {
    const { rerender } = render(<JustAdded latest={[]} total={0} ended={false} />)
    expect(screen.getByText('Events appear here once the rules engine starts reading structured records.')).toBeInTheDocument()
    rerender(<JustAdded latest={[]} total={106} ended />)
    expect(screen.getByText('This crawl added no new high-significance events.')).toBeInTheDocument()
  })

  it('lists the five newest events with how they were built', () => {
    const latest = ['f', 'e', 'd', 'c', 'b', 'a'].map((id) => event(id))
    latest[0] = event('f', { via: 'ai_events', title: 'FDA accepts Tyvaso sNDA', merged_sources: [{ collection: 'articles', record_key: 'x' }] })
    render(<JustAdded latest={latest} total={41} ended={false} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveTextContent('FDA accepts Tyvaso sNDAApr 1, 2021AI · merged 2 recordsHigh')
    expect(items[1]).toHaveTextContent('Rule · fda_records')
    expect(screen.getByText('41 events')).toBeInTheDocument()
  })
})
