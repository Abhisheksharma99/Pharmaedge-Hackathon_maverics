import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Landmark } from 'lucide-react'
import { ChartCard, ChartGrid } from './chart-card'
import { Donut } from './donut'
import { Funnel } from './funnel'
import { Gantt } from './gantt'
import { HBars } from './h-bars'
import { Heat } from './heat'
import { Legend } from './legend'
import { MiniDonut } from './mini-donut'
import { StackBars } from './stack-bars'
import { Stat, StatRow } from './stat'
import { TermBar } from './term-bar'
import { VBars } from './v-bars'

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error')
  warnSpy = vi.spyOn(console, 'warn')
})
afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled()
  expect(warnSpy).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

describe('ChartCard / ChartGrid', () => {
  it('renders title, description and content, spanning columns', () => {
    render(
      <ChartGrid>
        <ChartCard title="Source mix" description="Records by collection" span={2}>
          <p>body</p>
        </ChartCard>
      </ChartGrid>,
    )
    const card = screen.getByRole('region', { name: 'Source mix' })
    expect(within(card).getByText('Records by collection')).toBeInTheDocument()
    expect(within(card).getByText('body')).toBeInTheDocument()
    expect(card.className).toMatch(/col-span-2/)
  })
})

describe('Legend', () => {
  it('lists items with formatted values', () => {
    render(<Legend items={[{ l: 'fda', c: '#2347d9', v: 1240 }, { l: 'ema', c: '#5873e8' }]} />)
    expect(screen.getByText('fda')).toBeInTheDocument()
    expect(screen.getByText('1,240')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('Stat', () => {
  it('shows label, value and sub line', () => {
    render(
      <StatRow>
        <Stat icon={Landmark} label="Approved indications" value={2} sub="US, EU" color="#0b7a6f" />
      </StatRow>,
    )
    expect(screen.getByText('Approved indications')).toBeInTheDocument()
    expect(screen.getByText('2')).toHaveStyle({ color: '#0b7a6f' })
    expect(screen.getByText('US, EU')).toBeInTheDocument()
  })
})

describe('VBars', () => {
  it('draws one bar per datum with value and label', () => {
    const { container } = render(<VBars data={[{ l: 'P1', v: 1 }, { l: 'P2', v: 3 }, { l: 'P3', v: 9, c: '#2347d9' }]} />)
    expect(screen.getByRole('img', { name: 'P1: 1, P2: 3, P3: 9' })).toBeInTheDocument()
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    expect(screen.getByText('P3')).toBeInTheDocument()
  })
  it('renders empty data without NaN', () => {
    const { container } = render(<VBars data={[]} />)
    expect(container.innerHTML).not.toMatch(/NaN/)
  })
})

describe('StackBars', () => {
  const cols = [2024, 2025, 2026]
  const series = [
    { k: 'regulatory', l: 'Regulatory', c: '#2347d9', vals: [1, 0, 2] },
    { k: 'clinical', l: 'Clinical', c: '#0b7a6f', vals: [3, 1, 0] },
  ]
  it('stacks non-zero values, labels years as ’YY and totals the legend', () => {
    const { container } = render(<StackBars cols={cols} series={series} />)
    // 3 hover-band rects + 4 non-zero segments
    expect(container.querySelectorAll('rect')).toHaveLength(7)
    expect(screen.getByText('’24')).toBeInTheDocument()
    const legend = screen.getByRole('list')
    expect(within(legend).getByText('Regulatory')).toBeInTheDocument()
    expect(within(legend).getByText('3')).toBeInTheDocument() // Regulatory total (1 + 0 + 2)
  })
  it('shows a tooltip with the column breakdown on hover', async () => {
    const { container } = render(<StackBars cols={cols} series={series} />)
    await userEvent.hover(container.querySelectorAll('svg > g')[4]!) // first column group after 4 gridlines
    expect(screen.getByRole('tooltip')).toHaveTextContent('2024 · 4')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Regulatory 1 · Clinical 3')
  })
  it('renders all-zero series without NaN', () => {
    const { container } = render(<StackBars cols={cols} series={[{ k: 'x', l: 'X', c: '#000', vals: [0, 0, 0] }]} />)
    expect(container.innerHTML).not.toMatch(/NaN/)
  })
})

describe('HBars', () => {
  it('lists rows with proportional widths and units', () => {
    render(<HBars data={[{ l: 'PAH', v: 1965 }, { l: 'IPF', v: 1224, c: '#0b7a6f' }]} unit=" pts" />)
    expect(screen.getByText('PAH')).toBeInTheDocument()
    expect(screen.getByText('1,965 pts')).toBeInTheDocument()
    const bars = screen.getAllByRole('listitem').map((li) => li.querySelector('i') as HTMLElement)
    expect(bars[0]).toHaveStyle({ width: '100%' })
  })
})

describe('Donut', () => {
  const data = [
    { l: 'Ingest', v: 41, c: '#0b7a6f' },
    { l: 'Headline', v: 17, c: '#dc8a0e' },
    { l: 'Skip', v: 8, c: '#98a2b3' },
  ]
  it('shows the total in the centre and one arc per slice', () => {
    const { container } = render(<Donut data={data} sub="records" />)
    expect(container.querySelectorAll('circle')).toHaveLength(4) // track + 3 arcs
    expect(screen.getByText('66')).toBeInTheDocument()
    expect(screen.getByText('records')).toBeInTheDocument()
  })
  it('swaps the centre to the hovered slice', async () => {
    const { container } = render(<Donut data={data} />)
    await userEvent.hover(container.querySelectorAll('circle')[2]!)
    expect(screen.getAllByText('Headline').length).toBeGreaterThan(0)
    expect(screen.getAllByText('17').length).toBeGreaterThan(0)
  })
  it('shows 0, not 1, when there is no data', () => {
    render(<Donut data={[]} sub="events" />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

describe('MiniDonut', () => {
  it('renders the total and label', () => {
    render(<MiniDonut data={[{ l: 'fda', v: 2, c: '#2347d9' }, { l: 'articles', v: 3, c: '#98a2b3' }]} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('records')).toBeInTheDocument()
  })
})

describe('Funnel', () => {
  it('shows each step with its share of the previous step', () => {
    render(
      <Funnel
        steps={[
          { l: 'Unstructured records', v: 186, c: '#98a2b3' },
          { l: 'Relevant to the asset', v: 74, c: '#5873e8' },
          { l: 'Journey events', v: 0, c: '#0b7a6f' },
          { l: 'Pinned', v: 0, c: '#2347d9' },
        ]}
      />,
    )
    expect(screen.getByText('Unstructured records')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument() // 0 → 0 has no meaningful rate
  })
  it('renders an empty funnel without NaN', () => {
    const { container } = render(<Funnel steps={[]} />)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})

describe('Gantt', () => {
  const rows = [
    { l: 'TRIUMPH I', sub: 'PAH · n=235', s: 2005.4, e: 2007.8, c: '#2347d9', tag: 'P3' },
    { l: 'PERFECT', sub: 'PH-COPD · n=141', s: 2018.4, e: 2022.5, c: '#7a5af8', tag: 'P2', dash: true },
    { l: 'US 11,826,327', s: 2023.9, e: 2042.3, c: '#6941c6', tag: '2042' },
  ]
  it('labels rows, ticks the axis and marks today inside the range', () => {
    render(<Gantt rows={rows} from={2004} to={2028} today="2026-10-09" />)
    expect(screen.getByText('TRIUMPH I')).toBeInTheDocument()
    expect(screen.getByText('PAH · n=235')).toBeInTheDocument()
    expect(screen.getAllByText('2008').length).toBeGreaterThan(0)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('P2').parentElement).toHaveClass('border-dashed')
  })
  it('clamps a bar that runs past the axis and hides an out-of-range today', () => {
    render(<Gantt rows={rows} from={2004} to={2020} today="2026-10-09" />)
    const bar = screen.getByText('2042').parentElement as HTMLElement
    const left = parseFloat(bar.style.left)
    const width = parseFloat(bar.style.width)
    expect(left + width).toBeLessThanOrEqual(100.0001)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })
  it('keeps a minimum width when the end precedes the start', () => {
    render(<Gantt rows={[{ l: 'odd', s: 2010, e: 2009, c: '#000', tag: 'x' }]} from={2000} to={2020} today="2026-10-09" />)
    expect(parseFloat((screen.getByText('x').parentElement as HTMLElement).style.width)).toBeGreaterThan(0)
  })
})

describe('Heat', () => {
  it('renders a cell per row × column from the callback', () => {
    render(
      <Heat
        cols={['PAH', 'IPF']}
        rows={[{ l: 'Treprostinil', sub: 'this asset' }, { l: 'Nintedanib' }]}
        cell={(r, c) =>
          r.l === 'Treprostinil' && c === 'PAH'
            ? { label: 'Approved', bg: '#e6f4f2', fg: '#0b7a6f', t: 'approved' }
            : { label: '—', bg: '#f9fafb', fg: '#98a2b3' }
        }
      />,
    )
    expect(screen.getByText('Approved')).toHaveAttribute('title', 'approved')
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.getByText('this asset')).toBeInTheDocument()
  })
})

describe('TermBar', () => {
  it('shows start, label, end and today', () => {
    render(<TermBar start="2021-06-01" end="2026-02-02" label="Phase 3 · n=576" color="#2347d9" today="2026-10-09" />)
    expect(screen.getByText('2021-06-01')).toBeInTheDocument()
    expect(screen.getByText('Phase 3 · n=576')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })
  it('does not divide by zero when start equals end', () => {
    const { container } = render(<TermBar start="2021-06-01" end="2021-06-01" label="x" color="#2347d9" today="2026-10-09" />)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})

describe('review fixes: geometry guards', () => {
  const pct = (el: HTMLElement, prop: 'left' | 'width') => parseFloat(el.style[prop])

  it('Funnel bars never exceed their track, even when a later step is larger or the first is 0', () => {
    const { rerender } = render(<Funnel steps={[{ l: 'a', v: 10, c: '#000' }, { l: 'b', v: 40, c: '#111' }]} />)
    const widths = () => screen.getAllByRole('listitem').map((li) => pct(li.querySelector('span > span') as HTMLElement, 'width'))
    expect(widths().every((w) => Number.isFinite(w) && w > 0 && w <= 100)).toBe(true)
    rerender(<Funnel steps={[{ l: 'a', v: 0, c: '#000' }, { l: 'b', v: 0, c: '#111' }, { l: 'c', v: 12, c: '#222' }]} />)
    expect(widths().every((w) => Number.isFinite(w) && w > 0 && w <= 100)).toBe(true)
  })

  it('Gantt skips the bar of a row whose dates are unknown', () => {
    render(<Gantt rows={[{ l: 'pending', s: 2020, e: Number.NaN, c: '#6941c6', tag: 'P' }, { l: 'ok', s: 2010, e: 2015, c: '#000', tag: 'K' }]} from={2000} to={2030} today="2026-10-09" />)
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.queryByText('P')).not.toBeInTheDocument()
    expect(screen.getByText('Dates unknown')).toBeInTheDocument()
    const bar = screen.getByText('K').parentElement as HTMLElement
    expect(pct(bar, 'left')).toBeCloseTo(33.33, 1)
    expect(pct(bar, 'width')).toBeCloseTo(16.67, 1)
  })

  it('TermBar with a missing date shows only its label', () => {
    render(<TermBar start="2021-06-01" end="" label="Phase 3 · n=576" color="#2347d9" today="2026-10-09" />)
    expect(screen.getByText('Phase 3 · n=576')).toBeInTheDocument()
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('TermBar positions are finite numbers inside the track', () => {
    const { container } = render(<TermBar start="2021-06-01" end="2021-06-01" label="x" color="#2347d9" today="2026-10-09" />)
    for (const el of container.querySelectorAll<HTMLElement>('[style*="left"]')) {
      expect(Number.isFinite(pct(el, 'left'))).toBe(true)
    }
  })

  it('StackBars ticks are whole, evenly spaced numbers for small counts and absent without data', () => {
    const ticks = (c: HTMLElement) => [...c.querySelectorAll('svg > g')].slice(0, 4).map((g) => g.querySelector('text')?.textContent)
    const { container, rerender } = render(<StackBars cols={[2024, 2025]} series={[{ k: 'a', l: 'A', c: '#000', vals: [1, 0] }]} />)
    expect(ticks(container)).toEqual(['1', '2', '3', '4'])
    rerender(<StackBars cols={[2024, 2025]} series={[{ k: 'a', l: 'A', c: '#000', vals: [5, 2] }]} />)
    expect(ticks(container)).toEqual(['2', '4', '6', '8'])
    rerender(<StackBars cols={[2024, 2025]} series={[{ k: 'a', l: 'A', c: '#000', vals: [0, 0] }]} />)
    expect(container.querySelectorAll('svg > g text').length).toBe(0 + 2) // only the two column labels
  })
})
