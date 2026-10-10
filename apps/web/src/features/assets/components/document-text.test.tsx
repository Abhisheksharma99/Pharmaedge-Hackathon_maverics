import { render, screen, within } from '@testing-library/react'
import { DocumentText, MentionExcerpts, excerpts, segments } from './document-text'

// Shape of a crawled earnings release (BMS Q3 2023): headline lines, a flattened table, the asset paragraphs, boilerplate.
const RELEASE = [
  'Reports Third Quarter Revenues of $11.0 Billion',
  'PRINCETON, N.J.--(BUSINESS WIRE)--',
  'Bristol Myers Squibb (NYSE:BMY) today reports results for the third quarter of 2023, which reflect significant pipeline progress.',
  'Third Quarter', '2023', '2022', 'Change', 'Total Revenues', '$10,966', '$11,218', '(2)%', '(3)%',
  'The FDA granted BMS-986278, a potential first-in-class oral, lysophosphatidic acid receptor 1 (LPA1) antagonist, Breakthrough Therapy Designation for the treatment of progressive pulmonary fibrosis (PPF).',
  'Results from the Phase 2 study evaluating BMS-986278 in patients with PPF demonstrated that twice-daily administration of 60mg reduced the rate of decline in ppFVC by 69% compared to placebo.',
  'Use of Non-GAAP Financial Information',
  'In discussing financial results and guidance, the company refers to financial measures that are not in accordance with GAAP.',
  'Cautionary Statement Regarding Forward-Looking Statements',
].join('\n')

describe('readable documents', () => {
  it('collapses flattened tables and stops before boilerplate', () => {
    const { segments: parts, trimmed } = segments(RELEASE)
    expect(parts.map((p) => p.kind)).toEqual(['p', 'p', 'p', 'table', 'p', 'p'])
    expect(parts[3]).toEqual({ kind: 'table', cells: 9 })
    expect(trimmed).toBe(true)
  })

  it('pulls the passages about the asset to the top, highlighted', () => {
    expect(excerpts(RELEASE, ['BMS-986278'])).toHaveLength(2)
    expect(excerpts(RELEASE, ['BMS-9862'])).toHaveLength(0) // whole names only
    render(<MentionExcerpts text={RELEASE} names={['BMS-986278']} assetName="Admilparant" />)
    const section = screen.getByRole('region', { name: 'What it says about Admilparant' })
    expect(within(section).getAllByRole('listitem')).toHaveLength(2)
    expect(within(section).getAllByText('BMS-986278')[0]!.tagName).toBe('MARK')
  })

  it('joins wrapped lines and keeps short headings that are not tables', () => {
    const { segments: parts } = segments(
      ['* GAAP and Non-GAAP earnings per share include the net impact of charges, which decreased by $0.03 per share',
       'in the third quarter of 2023 compared to an increase in 2022.', 'THIRD QUARTER FINANCIAL RESULTS',
       'Bristol Myers Squibb posted third quarter revenues of $11.0 billion, a decrease of 2%.'].join('\n'))
    expect(parts).toEqual([
      { kind: 'p', text: '* GAAP and Non-GAAP earnings per share include the net impact of charges, which decreased by $0.03 per share in the third quarter of 2023 compared to an increase in 2022.' },
      { kind: 'p', text: 'THIRD QUARTER FINANCIAL RESULTS' },
      { kind: 'p', text: 'Bristol Myers Squibb posted third quarter revenues of $11.0 billion, a decrease of 2%.' },
    ])
  })

  it('keeps the full text one click away, without the tables or legal sections', () => {
    render(<DocumentText text={RELEASE} names={['BMS-986278']} open={false} />)
    expect(screen.getByText('Full text')).toBeInTheDocument()
    expect(screen.getByText(/Table \(9 values\)/)).toBeInTheDocument()
    expect(screen.queryByText(/In discussing financial results/)).not.toBeInTheDocument()
    expect(screen.getByText(/legal and financial-reporting sections are hidden/i)).toBeInTheDocument()
  })
})
