import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IndicationBadges, KindBadge } from './badges'

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

describe('IndicationBadges', () => {
  it('shows short labels with the full name on hover, once per indication', () => {
    render(<IndicationBadges items={['Idiopathic Pulmonary Fibrosis', 'IPF', 'PAH', 'Sarcoidosis-associated something very long']} max={3} />)
    expect(screen.getByText('IPF').parentElement).toHaveAttribute('title', 'Indication: Idiopathic Pulmonary Fibrosis')
    expect(screen.getByText('PAH').parentElement).toHaveAttribute('title', 'Indication: Pulmonary arterial hypertension')
    // A long name without a short form ellipsizes and keeps its full name in the tooltip.
    const long = screen.getByText('Sarcoidosis-associated something very long')
    expect(long).toHaveClass('truncate')
    expect(long.parentElement).toHaveAttribute('title', 'Indication: Sarcoidosis-associated something very long')
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('folds the rest into +N with their full names', () => {
    render(<IndicationBadges items={['PAH', 'Ulcerative colitis', 'CKD']} max={1} />)
    expect(screen.getByText('+2')).toHaveAttribute('title', 'Ulcerative colitis, Chronic kidney disease')
  })
})
