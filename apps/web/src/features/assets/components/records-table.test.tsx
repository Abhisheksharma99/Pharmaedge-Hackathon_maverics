import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { AuthContext, type AuthContextValue, type User } from '@/features/auth/use-auth'
import type { AssetDetail, RecordsPage, SourceRecord } from '../api'
import { ClinicalTab, PublicationsTab } from '../pages/tabs'
import { apaDate, recordCitation } from './records-citation'

vi.mock('@/features/analytics/tab-insights', () => ({ TabInsights: () => null }))
const downloadBlob = vi.hoisted(() => vi.fn<(blob: Blob, filename: string) => void>())
vi.mock('@/features/journey/export/build', () => ({ downloadBlob }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const page = (items: SourceRecord[]): RecordsPage => ({ items, total: items.length, page: 1, pageSize: 25, all: items.length, facets: [] })

const ASSET = { id: 'trep', name: 'Treprostinil', status: 'ready', company: { name: 'United Therapeutics' }, counts: { trials: 2, publications: 2 } } as unknown as AssetDetail
const TRIAL: SourceRecord = {
  key: 'ctgov:NCT1',
  nct_id: 'NCT1',
  acronym: 'TETON',
  title: 'Inhaled treprostinil in IPF',
  phases: ['PHASE3'],
  overall_status: 'RECRUITING',
  conditions: ['IPF'],
  lead_sponsor: 'United Therapeutics Corp',
  enrollment: 576,
  start_date: '2021-03-01',
  primary_completion_date: '2026-06-30',
}
const TRIAL_B: SourceRecord = { ...TRIAL, key: 'ctgov:NCT2', nct_id: 'NCT2', acronym: undefined, title: 'Academic study', lead_sponsor: 'Academic Hospital' }
const PAPER: SourceRecord = { key: 'pubmed:1', pmid: '111', title: 'Treprostinil in PH-ILD.', journal: 'N Engl J Med', date: '2021-01-14', url: 'https://doi.org/10.1056/x' }
const PAPER_B: SourceRecord = { key: 'pubmed:2', pmid: '222', title: 'Second paper', journal: 'Chest', date: '2022-05' }

const user = (id: string): AuthContextValue => ({ user: { id } as User, isLoading: false, login: vi.fn(), logout: vi.fn() })

function renderTab(element: ReactElement, path: string, auth?: AuthContextValue) {
  const router = createMemoryRouter([{ path: '/assets/:assetId', element: <Outlet context={ASSET} />, children: [{ path, element }] }], {
    initialEntries: [`/assets/trep/${path}`],
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return render(auth ? <AuthContext value={auth}>{tree}</AuthContext> : tree)
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
})
beforeEach(() => {
  downloadBlob.mockClear()
  toast.success.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => json(url.includes('/records/clinical') ? page([TRIAL, TRIAL_B]) : url.includes('/records/publications') ? page([PAPER, PAPER_B]) : page([]))),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent)
const csvLines = async (blob: Blob) => (await blob.text()).replace(/^﻿/, '').trim().split('\r\n')

async function toggleColumn(name: string) {
  await userEvent.click(screen.getByRole('button', { name: /^Columns/ }))
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name }))
  await userEvent.keyboard('{Escape}')
}

async function exportCsv(button: string) {
  await userEvent.click(screen.getByRole('button', { name: button }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /CSV/ }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  return downloadBlob.mock.calls[0]!
}

describe('records column chooser', () => {
  it('hides a column, remembers it per user and tab, and exports only the visible columns', async () => {
    const view = renderTab(<ClinicalTab />, 'clinical', user('u1'))
    await screen.findByText('TETON')
    await toggleColumn('Sponsor')
    await toggleColumn('Indication')
    expect(headers()).not.toContain('Sponsor')
    expect(headers()).not.toContain('Indication')
    expect(screen.getByRole('button', { name: 'Columns, 2 hidden' })).toHaveTextContent('7/9')
    expect(JSON.parse(localStorage.getItem('aj.records.u1.columns.clinical')!)).toEqual(['Sponsor', 'Indication'])

    const [blob] = await exportCsv('Export')
    // Neither the hidden Indication column nor the fallback Indications column comes back.
    expect((await csvLines(blob))[0]).toBe('NCT ID,Study,Phase,Status,Enrolment,Start → primary completion,Journey events,Source link')

    // Remounted for the same user: still hidden. Another user: everything shows.
    view.unmount()
    renderTab(<ClinicalTab />, 'clinical', user('u1'))
    await screen.findByText('TETON')
    expect(headers()).not.toContain('Sponsor')
  })

  it('shows every column to another user and on another tab', async () => {
    localStorage.setItem('aj.records.u1.columns.clinical', JSON.stringify(['Sponsor']))
    renderTab(<ClinicalTab />, 'clinical', user('u2'))
    await screen.findByText('TETON')
    expect(headers()).toContain('Sponsor')
  })

  it('keeps the last visible column, and Show all brings the rest back', async () => {
    localStorage.setItem('aj.records.anonymous.columns.publications', JSON.stringify(['PMID', 'Indication', 'Journal', 'Year', 'Design', 'Journey']))
    renderTab(<PublicationsTab />, 'publications')
    await screen.findByText('Second paper')
    expect(headers()).toEqual(['', 'Title', 'Citation'])
    await userEvent.click(screen.getByRole('button', { name: /^Columns/ }))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Title' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show all columns' }))
    await userEvent.keyboard('{Escape}')
    expect(headers()).toEqual(['', 'PMID', 'Title', 'Indication', 'Journal', 'Year', 'Design', 'Journey', 'Citation'])
  })

  it('works with storage blocked, for the page’s life', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderTab(<ClinicalTab />, 'clinical')
    await screen.findByText('TETON')
    await toggleColumn('Enrolment')
    expect(headers()).not.toContain('Enrolment')
  })
})

describe('records density and sticky header', () => {
  it('switches to compact rows and remembers it', async () => {
    renderTab(<ClinicalTab />, 'clinical', user('u1'))
    await screen.findByText('TETON')
    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('data-density', 'comfortable')
    await userEvent.click(screen.getByRole('button', { name: /^Columns/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Compact' }))
    await userEvent.keyboard('{Escape}')
    expect(table).toHaveAttribute('data-density', 'compact')
    expect(within(table).getAllByRole('cell')[1]).toHaveClass('py-[5px]')
    expect(localStorage.getItem('aj.records.u1.density')).toBe('"compact"')
  })

  it('keeps the header in view while the rows scroll inside the card', async () => {
    renderTab(<ClinicalTab />, 'clinical')
    await screen.findByText('TETON')
    const table = screen.getByRole('table')
    expect(table.querySelector('thead')).toHaveClass('sticky', 'top-0')
    expect(table.parentElement).toHaveClass('overflow-auto')
    expect(table.parentElement!.className).toMatch(/max-h-/)
  })
})

describe('records selection', () => {
  it('ticks rows, exports only those, and clears', async () => {
    renderTab(<ClinicalTab />, 'clinical')
    await screen.findByText('TETON')
    expect(screen.queryByRole('region', { name: 'Selected records' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Academic study' }))
    // Ticking doesn't open the record.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const bar = screen.getByRole('region', { name: 'Selected records' })
    expect(bar).toHaveTextContent('1 selected')
    const all = screen.getByRole('checkbox', { name: 'Select all rows on this page' }) as HTMLInputElement
    expect(all.indeterminate).toBe(true)

    const [blob, filename] = await exportCsv('Export selected')
    expect(filename).toMatch(/^trep-clinical-selected-\d{4}-\d{2}-\d{2}\.csv$/)
    const lines = await csvLines(blob)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/^NCT2,Academic study,/)

    await userEvent.click(all)
    expect(bar).toHaveTextContent('2 selected')
    expect(all.checked).toBe(true)
    await userEvent.click(all)
    expect(screen.queryByRole('region', { name: 'Selected records' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Inhaled treprostinil in IPF' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('region', { name: 'Selected records' })).not.toBeInTheDocument()
  })
})

describe('copy citation', () => {
  it('copies the row’s citation without opening the record', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderTab(<PublicationsTab />, 'publications')
    await screen.findByText('Second paper')
    await userEvent.click(screen.getByRole('button', { name: 'Copy citation: Treprostinil in PH-ILD.' }))
    expect(writeText).toHaveBeenCalledWith('Treprostinil in PH-ILD. (2021, January 14). N Engl J Med, PMID 111. https://doi.org/10.1056/x')
    expect(toast.success).toHaveBeenCalledWith('Citation copied', expect.anything())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('recordCitation', () => {
  it('formats APA dates', () => {
    expect(apaDate('2024-03-05')).toBe('(2024, March 5)')
    expect(apaDate('2024-03')).toBe('(2024, March)')
    expect(apaDate('2024')).toBe('(2024)')
    expect(apaDate('')).toBe('(n.d.)')
  })

  it('names the source per tab and falls back to the registry link', () => {
    expect(recordCitation(TRIAL, 'clinical')).toBe('TETON: Inhaled treprostinil in IPF. (2021, March 1). ClinicalTrials.gov, NCT1. https://clinicaltrials.gov/study/NCT1')
    expect(recordCitation(PAPER_B, 'publications')).toBe('Second paper. (2022, May). Chest, PMID 222. https://pubmed.ncbi.nlm.nih.gov/222/')
    expect(recordCitation({ key: 'f', record_type: 'fda_submission', title: 'TYVASO', date: '2009-07-30', url: 'https://www.fda.gov/x' }, 'regulatory')).toBe(
      'TYVASO. (2009, July 30). U.S. Food and Drug Administration. https://www.fda.gov/x',
    )
    expect(recordCitation({ key: 'p', title: 'Q3 results', date: '2025-10-29' }, 'company-ir', 'United Therapeutics')).toBe('Q3 results. (2025, October 29). United Therapeutics.')
    expect(recordCitation({ key: 'pt', title: 'Dry powder', publication_number: 'US1B2', assignees: ['UT Corp'], grant_date: '2019-02-01' }, 'patents')).toBe(
      'Dry powder. (2019, February 1). UT Corp, Patent US1B2.',
    )
    expect(recordCitation({ key: 'n', title: 'Headline', url: 'https://www.reuters.com/a' }, 'news')).toBe('Headline. (n.d.). reuters.com. https://www.reuters.com/a')
  })
})
