import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { KindBadge } from './badges'

const wrap = (ui: React.ReactNode) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)

describe('KindBadge', () => {
  it('labels a primary asset and explains it on hover', async () => {
    wrap(<KindBadge kind="primary" />)
    const badge = screen.getByText('Primary')
    expect(badge).toHaveClass('bg-primary-soft')
    await userEvent.hover(badge)
    expect((await screen.findAllByText('Primary asset · full crawl')).length).toBeGreaterThan(0)
  })
  it('names the primaries a competitor is tracked against', async () => {
    wrap(<KindBadge kind="competitor" competitorOf={['Treprostinil']} />)
    const badge = screen.getByText('Competitor')
    expect(badge).toHaveClass('bg-orange-soft', 'text-competitor')
    await userEvent.hover(badge)
    expect((await screen.findAllByText('Competitor of Treprostinil · light crawl')).length).toBeGreaterThan(0)
  })
})
