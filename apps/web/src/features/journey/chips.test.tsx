import { render, screen } from '@testing-library/react'
import { BranchChip, CountdownChip, DetailsGrid, NoteTagChip, Targets } from './chips'
import { eventDate } from './format'
import type { Branch, JourneyEventV3 } from './types'

const EVENT: JourneyEventV3 = {
  id: 'e1', asset: 'trep', date: '2021-06-01', type: 'trial_start', category: 'clinical', title: 'Phase 3 trial started: TETON-1',
  significance: 'High', is_milestone: false, sources: [], via: 'journey', indications: ['IPF', 'PPF', 'ILD'], product: 'Tyvaso', region: 'US',
}
const CTEPH: Branch = { id: 'CTEPH', label: 'CTEPH', full: 'Chronic thromboembolic PH', color: '#0e7490', off: -1, status: 'Approved · EU', origin: 'ai' }

describe('journey chips', () => {
  it('labels branches, tags and countdowns in text, not colour alone', () => {
    render(
      <>
        <BranchChip branch={CTEPH} current />
        <NoteTagChip tag="Missed by AI" />
        <CountdownChip date="2099-01-01" />
      </>,
    )
    expect(screen.getByText('CTEPH')).toHaveStyle({ color: '#0e7490' })
    expect(screen.getByText('Missed by AI')).toBeInTheDocument()
    expect(screen.getByText(/^in \d+\.\d years$/)).toBeInTheDocument()
  })

  it('formats card dates, milestones as expected months', () => {
    expect(eventDate({ date: '2002-05-21', is_milestone: false })).toBe('May 21, 2002')
    expect(eventDate({ date: '2027-03-31', is_milestone: true })).toBe('Expected Mar 2027')
    expect(eventDate({ date: '2027-03-31', is_milestone: true }, { short: true })).toBe('Exp. Mar 2027')
    expect(eventDate({ date: '2027-03-31', is_milestone: true }, { day: true })).toBe('Expected Mar 31, 2027')
  })

  it('shows targets, limited when asked, and nothing without any', () => {
    const { rerender, container } = render(<Targets e={EVENT} label />)
    expect(screen.getByText('Targets')).toBeInTheDocument()
    expect(screen.getAllByText(/^(IPF|PPF|ILD)$/)).toHaveLength(3)
    expect(screen.getByText('Tyvaso')).toBeInTheDocument()
    expect(screen.getByText('US')).toBeInTheDocument()
    rerender(<Targets e={EVENT} small limit={2} />)
    expect(screen.queryByText('ILD')).not.toBeInTheDocument()
    expect(screen.queryByText('Targets')).not.toBeInTheDocument()
    rerender(<Targets e={{ ...EVENT, indications: [], product: null }} label />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lays out key facts with identifiers in mono and skips empty values', () => {
    render(<DetailsGrid details={{ Trial: 'NCT04708782', Phase: 'Phase 3', Empty: '' }} />)
    expect(screen.getByText('NCT04708782')).toHaveClass('font-mono')
    expect(screen.getByText('Phase 3')).not.toHaveClass('font-mono')
    expect(screen.queryByText('Empty')).not.toBeInTheDocument()
  })
})
