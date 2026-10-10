import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventSheet } from '@/stores/event-sheet-store'
import type { JourneyEventV3 } from '../types'
import { JustAdded } from './just-added'

const ID = 'ai:trep:https://example.com/a/b:0'
const EVENT: JourneyEventV3 = { id: ID, asset: 'trep', date: '2026-10-09', type: 'approval', category: 'regulatory', title: 'FDA approves Tyvaso for IPF', significance: 'High', is_milestone: false, sources: [], via: 'ai_events' }

describe('JustAdded', () => {
  beforeEach(() => useEventSheet.setState({ current: null }))
  it('opens a just-added event in the event sheet', async () => {
    render(<JustAdded latest={[EVENT]} total={1} ended={false} />)
    await userEvent.click(screen.getByRole('button', { name: /FDA approves Tyvaso for IPF/ }))
    expect(useEventSheet.getState().current).toEqual({ assetId: 'trep', eventId: ID })
  })
})
