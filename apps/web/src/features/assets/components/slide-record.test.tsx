import { render, screen, within } from '@testing-library/react'
import type { SourceRecord } from '../api'
import { SlideBody, isSlide, orderFigures, slideHeading } from './slide-record'

const SLIDE = {
  key: 'presentation:pres_a:3',
  record_type: 'presentation_slide',
  date: '2026-02-25',
  deck_title: '4Q EPS Presentation',
  slide_title: 'TETON-2 results',
  page: 3,
  url: 'https://ir.example.com/q4.pdf',
  company: 'United Therapeutics Corp',
  slide_type: 'clinical_data',
  slide_text: 'Tyvaso in IPF\nTETON-2 met its primary endpoint',
  claims: [
    { statement: 'TETON-2 met its primary endpoint', category: 'efficacy', drug: 'Tyvaso', trial: 'TETON-2' },
    { statement: 'Revenue grew 7%', category: 'financial' },
  ],
  metrics: [
    { metric: 'FVC change', value: 95.6, unit: 'mL', arm: 'Tyvaso', comparator: 'placebo', timepoint: 'Week 52', validation: { status: 'validated' } },
    { metric: 'Revenue change', value: 7, value_text: '7%', unit: 'percent', validation: { status: 'unverified' } },
    { metric: 'Responders', value: 40, unit: 'percent', validation: { status: 'conflict' } },
  ],
} as unknown as SourceRecord

describe('investor-presentation slide panel', () => {
  it('reads as a slide: heading, page link, grouped statements, figures with their check', () => {
    expect(isSlide(SLIDE)).toBe(true)
    expect(slideHeading(SLIDE)).toEqual({ title: 'TETON-2 results', subtitle: '4Q EPS Presentation · slide 3 · 25 Feb 2026' })
    render(<SlideBody record={SLIDE} />)

    expect(screen.getByRole('link', { name: /open slide 3 in the deck/i })).toHaveAttribute('href', 'https://ir.example.com/q4.pdf#page=3')
    const statements = screen.getByRole('region', { name: 'Key statements' })
    expect(within(statements).getByText('Efficacy')).toBeInTheDocument()
    expect(within(statements).getByText('TETON-2 met its primary endpoint')).toBeInTheDocument()
    expect(within(statements).getByText('Financial')).toBeInTheDocument()

    const figures = screen.getByRole('region', { name: 'Reported figures' })
    const rows = within(figures).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('95.6 mL')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Tyvaso vs placebo')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Week 52')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/chart-checked/i)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('7%')).toBeInTheDocument() // printed value wins over value + unit
    expect(within(rows[1]!).getByText('As printed')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('40%')).toBeInTheDocument()
    expect(within(rows[2]!).getByText(/conflicts with chart/i)).toBeInTheDocument()
    expect(screen.getByText('Slide text')).toBeInTheDocument() // folded away, not dumped
  })

  it('never links to unsafe URLs', () => {
    render(<SlideBody record={{ ...SLIDE, url: 'javascript:alert(1)' } as SourceRecord} />)
    expect(screen.queryByRole('link', { name: /open slide/i })).not.toBeInTheDocument()
  })
})

describe('figure details', () => {
  it('does not repeat the comparator or p-value already in the text', () => {
    const record = { ...SLIDE, metrics: [{ metric: 'Hodges-Lehmann estimate', value_text: '111.8 mL (95% CI, 79.7–144.0); P<0.0001',
      arm: 'Inhaled treprostinil vs placebo', comparator: 'Placebo', p_value_text: 'P<0.0001', timepoint: 'Week 52' }] } as unknown as SourceRecord
    render(<SlideBody record={record} />)
    const row = within(screen.getByRole('region', { name: 'Reported figures' })).getByRole('listitem')
    expect(within(row).getByText('Inhaled treprostinil vs placebo')).toBeInTheDocument()
    expect(within(row).queryByText(/vs placebo vs/i)).not.toBeInTheDocument()
    expect(within(row).getAllByText(/P<0\.0001/)).toHaveLength(1)
  })
})

describe('figure order', () => {
  it('puts outcomes first, then head-counts by arm and timepoint', () => {
    const order = orderFigures([
      { metric: 'Number of subjects', arm: 'Placebo', timepoint: 'Week 52' },
      { metric: 'Number of subjects', arm: 'Placebo', timepoint: 'Week 8' },
      { metric: 'Risk reduction', arm: 'Tyvaso' },
      { metric: 'Number of subjects', arm: 'Placebo', timepoint: 'Baseline' },
      { metric: 'FVC change', arm: 'Tyvaso', timepoint: 'Week 52' },
    ]).map((m) => `${m.metric}|${m.timepoint ?? ''}`)
    expect(order).toEqual(['Risk reduction|', 'FVC change|Week 52', 'Number of subjects|Baseline', 'Number of subjects|Week 8', 'Number of subjects|Week 52'])
  })
})
