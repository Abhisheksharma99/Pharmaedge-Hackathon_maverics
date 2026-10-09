import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Citation } from './api'
import { splitCitations } from './citations'
import { ChatMarkdown } from './components/chat-markdown'

const cite = (n: number, title: string): Citation => ({
  n,
  title,
  source: 'ClinicalTrials.gov',
  date: '2025-09-01',
  assetId: 'treprostinil',
  assetName: 'Treprostinil',
  collection: 'trial_records',
  recordKey: `NCT${n}`,
  tab: 'clinical',
})

describe('splitCitations', () => {
  it.each([
    ['Approved [1].', ['Approved ', 1, '.']],
    ['Two [1][3] markers', ['Two ', 1, 3, ' markers']],
    ['A list [1, 3]', ['A list ', 1, 3]],
    ['[2] first', [2, ' first']],
    ['No markers [a] or [ ]', ['No markers [a] or [ ]']],
  ])('%s', (text, parts) => {
    expect(splitCitations(text)).toEqual(parts)
  })
})

describe('ChatMarkdown citations', () => {
  it('renders markers as chips that open their citation', async () => {
    const onCite = vi.fn()
    const one = cite(1, 'TETON-2 results')
    render(
      <ChatMarkdown
        content={'Met the endpoint [1][3] and again [1, 3]. Unknown [2]. Code `[1]` stays.\n\n| Metric | Value [3] |\n|---|---|\n| FVC | +95 mL [1] |'}
        citations={[one, cite(3, 'TETON-1 results')]}
        onCite={onCite}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Source 1: TETON-2 results' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Source 3: TETON-1 results' })).toHaveLength(3)
    // No citation 2 → a plain marker, not a button.
    expect(screen.queryByRole('button', { name: /Source 2/ })).not.toBeInTheDocument()
    expect(screen.getByText('2').tagName).toBe('SUP')
    expect(screen.getByText('[1]').tagName).toBe('CODE')
    expect(within(screen.getByRole('table')).getAllByRole('button')).toHaveLength(2)

    await userEvent.click(screen.getAllByRole('button', { name: 'Source 1: TETON-2 results' })[0]!)
    expect(onCite).toHaveBeenCalledWith(one)
  })
})
