import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventSheet } from '@/stores/event-sheet-store'
import { TimelineCard } from './timeline-card'

const ID = 'ai:trep:https://example.com/a/b:0'

describe('TimelineCard', () => {
  beforeEach(() => useEventSheet.setState({ current: null }))

  it('opens each journey event in the event sheet, including events without a source record', async () => {
    render(
      <TimelineCard
        card={{
          type: 'timeline',
          title: 'Treprostinil · key events',
          assetId: 'trep',
          events: [
            { id: ID, assetId: 'trep', assetName: 'Treprostinil', date: '2021-03-31', title: 'Tyvaso approved for PH-ILD', category: 'regulatory', significance: 'High', is_milestone: false, sources: [] },
          ],
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Tyvaso approved for PH-ILD/ }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: ID })
  })

  it('shows a category icon, a numbered cite chip, and "expected Mon yyyy" for milestones only', async () => {
    render(
      <TimelineCard
        card={{
          type: 'timeline',
          title: 'Upcoming and past',
          assetId: 'trep',
          events: [
            { id: 'a', assetId: 'trep', assetName: 'Treprostinil', date: '2021-03-31', title: 'Tyvaso approved', category: 'regulatory', significance: 'High', is_milestone: false, sources: [] },
            { id: 'b', assetId: 'sota', assetName: 'Sotatercept', date: '2027-03-31', title: 'Readout expected', category: 'clinical', significance: 'Medium', is_milestone: true, sources: [] },
          ],
        }}
      />,
    )
    const rows = within(screen.getByRole('list', { name: 'Upcoming and past' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)

    // CategoryIcon: the tile is labelled by its category.
    expect(within(rows[0]).getByTitle('Regulatory')).toBeInTheDocument()
    expect(within(rows[1]).getByTitle('Clinical')).toBeInTheDocument()

    // A dated event reads the full day; a milestone reads "expected Mon yyyy".
    expect(rows[0]).toHaveTextContent('Treprostinil · Mar 31, 2021')
    expect(rows[0]).not.toHaveTextContent('expected')
    expect(rows[1]).toHaveTextContent('Sotatercept · expected Mar 2027')

    // The cite chip is numbered by position and opens that event.
    const chip = within(rows[1]).getByRole('button', { name: 'Open event 2: Readout expected' })
    expect(chip).toHaveTextContent('2')
    await userEvent.click(chip)
    expect(useEventSheet.getState().current).toEqual({ assetId: 'sota', eventId: 'b' })
  })
})
