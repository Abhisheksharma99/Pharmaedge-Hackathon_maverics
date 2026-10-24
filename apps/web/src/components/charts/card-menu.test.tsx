import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { todayIso } from '@/lib/dates'
import { fractionMonth } from './card-data'
import { svgMarkup } from './card-png'
import { ChartCard } from './chart-card'
import { HBars } from './h-bars'
import { StackBars } from './stack-bars'
import { VBars } from './v-bars'

const downloadBlob = vi.hoisted(() => vi.fn<(blob: Blob, filename: string) => void>())
vi.mock('@/features/journey/export/build', () => ({ downloadBlob }))
const cardPng = vi.hoisted(() => vi.fn(async () => new Blob(['png'], { type: 'image/png' })))
vi.mock('./card-png', async (importOriginal) => ({ ...(await importOriginal<typeof import('./card-png')>()), cardPng }))

const BARS = [
  { l: 'P1', v: 2, c: '#2347d9' },
  { l: 'P2', v: 5, c: '#0b7a6f' },
  { l: 'P3', v: 1, c: '#6941c6' },
]

/** A card whose chart filters its rows, as the analytics cards do with their filter bars. */
function FilteredCard() {
  const [min, setMin] = useState(0)
  return (
    <ChartCard title="Trials by phase" menu={{ subject: 'Treprostinil' }}>
      <button type="button" onClick={() => setMin(2)}>
        Only 2+
      </button>
      <VBars data={BARS.filter((b) => b.v >= min)} />
    </ChartCard>
  )
}

const openMenu = (title = 'Trials by phase') => userEvent.click(screen.getByRole('button', { name: `${title}: more actions` }))
const csvLines = async (blob: Blob) => (await blob.text()).replace(/^﻿/, '').trim().split('\r\n')

beforeEach(() => {
  downloadBlob.mockClear()
  cardPng.mockClear()
})

describe('ChartCard menu', () => {
  it('has no menu unless asked for', () => {
    render(
      <ChartCard title="Plain">
        <VBars data={BARS} />
      </ChartCard>,
    )
    expect(screen.queryByRole('button', { name: /more actions/ })).not.toBeInTheDocument()
  })

  it('offers Expand, the PNG and the CSV for an SVG chart', async () => {
    render(<FilteredCard />)
    await openMenu()
    expect(screen.getByRole('menuitem', { name: 'Expand' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Download image (PNG)' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Download data (CSV)' })).toBeInTheDocument()
    expect(screen.queryByText(/isn’t drawn as SVG/)).not.toBeInTheDocument()
  })

  it('downloads the series the chart draws now, filters applied', async () => {
    render(<FilteredCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Only 2+' }))
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download data (CSV)' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const [blob, filename] = downloadBlob.mock.calls[0]!
    expect(filename).toBe(`treprostinil-trials-by-phase-${todayIso()}.csv`)
    expect(await csvLines(blob)).toEqual(['Label,Value', 'P1,2', 'P2,5'])
  })

  it('hides the image for a chart that is not SVG, and says why', async () => {
    render(
      <ChartCard title="Enrolment" menu={{ subject: 'Treprostinil' }}>
        <HBars data={BARS} />
      </ChartCard>,
    )
    await openMenu('Enrolment')
    expect(screen.queryByRole('menuitem', { name: /Download image/ })).not.toBeInTheDocument()
    expect(screen.getByText('No image download: this chart isn’t drawn as SVG.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download data (CSV)' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(await csvLines(downloadBlob.mock.calls[0]![0])).toEqual(['Label,Value', 'P1,2', 'P2,5', 'P3,1'])
  })

  it('disables the CSV when the chart draws nothing', async () => {
    render(
      <ChartCard title="Empty" menu={{ subject: 'Treprostinil' }}>
        <p>Nothing matches these filters.</p>
      </ChartCard>,
    )
    await openMenu('Empty')
    expect(screen.getByRole('menuitem', { name: 'No data to download' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('renders the PNG from the chart SVG with the title, asset and date, and the legend', async () => {
    render(
      <ChartCard title="Activity" menu={{ subject: 'Treprostinil' }}>
        <StackBars cols={[2020, 2021]} series={[{ k: 'reg', l: 'Regulatory', c: '#2347d9', vals: [1, 2] }]} />
      </ChartCard>,
    )
    await openMenu('Activity')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download image (PNG)' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    const [svg, caption] = cardPng.mock.calls[0]! as unknown as [SVGSVGElement, { title: string; caption: string; legend: unknown }]
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(caption.title).toBe('Activity')
    expect(caption.caption).toBe(`Treprostinil · ${todayIso()}`)
    expect(caption.legend).toEqual([{ l: 'Regulatory', c: '#2347d9' }])
    expect(downloadBlob.mock.calls[0]![1]).toBe(`treprostinil-activity-${todayIso()}.png`)
  })

  it('expands the chart large in a dialog with its own downloads, from the keyboard', async () => {
    render(<FilteredCard />)
    screen.getByRole('button', { name: 'Trials by phase: more actions' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Expand' })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Trials by phase' })
    // VBars draws at twice its height when expanded (150 → 300, plus 34 for the labels).
    expect(within(dialog).getByRole('img')).toHaveAttribute('height', '334')
    // The dialog's chart filters on its own and its CSV follows it.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Only 2+' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Trials by phase: more actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Expand' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download data (CSV)' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(await csvLines(downloadBlob.mock.calls[0]![0])).toEqual(['Label,Value', 'P1,2', 'P2,5'])
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('svgMarkup', () => {
  it('makes a standalone, padded, 2× SVG without classes', () => {
    document.body.innerHTML = '<svg width="200" height="100" role="img" class="block"><text class="fill-muted-foreground" style="font-size:11px">P1</text></svg>'
    const { markup, width, height } = svgMarkup(document.querySelector('svg')!)
    expect([width, height]).toEqual([224, 124])
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(markup).toContain('viewBox="-12 -12 224 124"')
    expect(markup).toContain('width="448"')
    expect(markup).toContain('height="248"')
    expect(markup).not.toContain('class=')
    expect(markup).not.toContain('role=')
    expect(markup).toContain('font-size:11px')
  })
})

describe('fractionMonth', () => {
  it('turns a year fraction back into a month', () => {
    expect(fractionMonth(2021 + 1 / 365)).toBe('2021-01')
    expect(fractionMonth(2026 + (5 * 30.4 + 30) / 365)).toBe('2026-06')
    expect(fractionMonth(2008 + (11 * 30.4 + 31) / 365)).toBe('2008-12')
    expect(fractionMonth(NaN)).toBe('')
  })
})
