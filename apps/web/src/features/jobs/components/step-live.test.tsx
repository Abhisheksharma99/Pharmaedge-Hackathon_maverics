import { render, screen } from '@testing-library/react'
import type { JobStep } from '../api'
import { StepBar } from './step-bar'
import { StepLive, StepLiveInline } from './step-live'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const step = (progress: JobStep['progress'], name = 'fda_calendar'): JobStep => ({
  name,
  label: 'FDA calendar (PDUFA dates, advisory committees)',
  status: 'running',
  counts: {},
  error: null,
  started_at: '2026-10-24T11:40:00Z',
  finished_at: null,
  progress,
})
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString()

describe('StepLive', () => {
  it("shows the running step's count and when it last moved", () => {
    render(<StepLive step={step({ done: 1240, total: null, unit: 'pages checked', note: '12 events found', at: at(8) })} now={NOW} />)
    expect(screen.getByText('FDA calendar ·')).toBeInTheDocument()
    expect(screen.getByText('1,240 pages checked · 12 events found')).toBeInTheDocument()
    expect(screen.getByText('Last update 8 s ago')).toBeInTheDocument()
    expect(screen.queryByText(/may be stalled/)).not.toBeInTheDocument()
  })

  it('fills a determinate bar when the step knows its total', () => {
    const { container } = render(<StepLive step={step({ done: 450, total: 1800, unit: 'records triaged', note: null, at: at(2) })} now={NOW} named={false} />)
    expect(screen.getByText('450 of 1,800 records triaged')).toBeInTheDocument()
    expect(screen.getByText('Last update just now')).toBeInTheDocument()
    expect(container.querySelector('i')).toHaveStyle({ width: '25%' })
  })

  it('warns when a reporting step has not moved for minutes', () => {
    render(<StepLive step={step({ done: 1240, total: null, unit: 'pages checked', note: null, at: at(360) })} now={NOW} />)
    expect(screen.getByText('No progress for 6 min — may be stalled')).toBeInTheDocument()
    expect(screen.queryByText(/Last update/)).not.toBeInTheDocument()
  })

  it('keeps its rows for a step without a live count and between two steps', () => {
    const { rerender } = render(<StepLive step={step(undefined, 'journey')} now={NOW} named={false} />)
    expect(screen.getByText('Working…')).toBeInTheDocument()
    expect(screen.getByText('Running for 20 min')).toBeInTheDocument() // elapsed, never "stalled"
    rerender(<StepLive step={null} now={NOW} />)
    expect(screen.getByText('Starting the next step…')).toBeInTheDocument()
    expect(screen.getByTestId('step-live').children).toHaveLength(3)
  })

  it('has a one-line form for tables', () => {
    const { rerender } = render(<StepLiveInline step={step({ done: 1093, total: null, unit: 'releases collected', note: 'back to 2018', at: at(8) })} now={NOW} />)
    expect(screen.getByText('FDA calendar · 1,093 releases collected · back to 2018 · 8 s ago')).toHaveClass('text-muted-foreground')
    rerender(<StepLiveInline step={step({ done: 1093, total: null, unit: 'releases collected', note: null, at: at(420) })} now={NOW} />)
    expect(screen.getByText('FDA calendar · 1,093 releases collected · no progress for 7 min — may be stalled')).toHaveClass('text-warning')
  })
})

describe('StepBar', () => {
  it('fills the running segment when its step reports a total', () => {
    const { container } = render(<StepBar steps={[{ ...step(null), status: 'done' }, step({ done: 3, total: 4, unit: 'tickers priced', note: null, at: at(1) })]} />)
    expect(container.querySelector('[data-status="running"] b')).toHaveStyle({ width: '75%' })
  })
})
