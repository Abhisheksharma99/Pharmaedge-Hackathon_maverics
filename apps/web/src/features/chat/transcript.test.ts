import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, Citation } from './api'
import { buildConversationPdf } from './export-pdf'
import { filterSessions } from './session-filter'
import {
  answerAssets,
  answerMarkdown,
  answerPlainText,
  citationLink,
  conversationMarkdown,
  markdownToPlain,
  noteFromAnswer,
  transcriptFileName,
} from './transcript'

const ORIGIN = 'https://app.test'

const cite = (n: number, over: Partial<Citation> = {}): Citation => ({
  n,
  title: `Record ${n}`,
  source: 'ClinicalTrials.gov',
  date: '2025-09-01',
  url: `https://example.org/r${n}`,
  assetId: 'treprostinil',
  assetName: 'Treprostinil',
  collection: 'trial_records',
  recordKey: `NCT${n}`,
  tab: 'clinical',
  ...over,
})

const msg = (role: 'user' | 'assistant', content: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `${role}-${content.slice(0, 8)}`,
  role,
  content,
  cards: [],
  citations: [],
  followUps: [],
  createdAt: '',
  ...over,
})

const ANSWER = msg('assistant', '**TETON-2** met its primary endpoint [1].\n\n- FVC improved [1, 2]\n- Safety as expected [3]', {
  citations: [cite(1), cite(2, { url: undefined, collection: 'fda_records', tab: 'regulatory', recordKey: 'fda:1', source: 'FDA' }), cite(3, { assetId: 'nintedanib', assetName: 'Nintedanib' })],
})

describe('answer copies', () => {
  it('copies Markdown with numbered footnotes and source links (app link when the record has no URL)', () => {
    const md = answerMarkdown(ANSWER, ORIGIN)
    expect(md).toContain('**TETON-2** met its primary endpoint [^1].')
    expect(md).toContain('- FVC improved [^1][^2]')
    expect(md).toContain('[^1]: Record 1 (ClinicalTrials.gov, 1 Sep 2025, Treprostinil). <https://example.org/r1>')
    expect(md).toContain('[^2]: Record 2 (FDA, 1 Sep 2025, Treprostinil). <https://app.test/assets/treprostinil/regulatory?rtab=regulatory&record=fda%3A1>')
    expect(md).toContain('[^3]: Record 3 (ClinicalTrials.gov, 1 Sep 2025, Nintedanib).')
  })

  it('copies plain text: no markdown, markers kept, then a Sources list', () => {
    const text = answerPlainText(ANSWER, ORIGIN)
    expect(text).toBe(
      [
        'TETON-2 met its primary endpoint [1].',
        '',
        '• FVC improved [1, 2]',
        '• Safety as expected [3]',
        '',
        'Sources:',
        '[1] Record 1 (ClinicalTrials.gov, 1 Sep 2025, Treprostinil). https://example.org/r1',
        '[2] Record 2 (FDA, 1 Sep 2025, Treprostinil). https://app.test/assets/treprostinil/regulatory?rtab=regulatory&record=fda%3A1',
        '[3] Record 3 (ClinicalTrials.gov, 1 Sep 2025, Nintedanib). https://example.org/r3',
      ].join('\n'),
    )
  })

  it('reduces markdown to plain text (headings, emphasis, links, code, tables) without touching snake_case', () => {
    const md = '## Summary\n\nSee [the label](https://fda.gov/x) and `NCT01`.\n\n| Trial | Phase |\n|---|:---:|\n| TETON | 3 |\n\n_Note_: ~~old~~ value_in_name *stays*'
    expect(markdownToPlain(md)).toBe('Summary\n\nSee the label (https://fda.gov/x) and NCT01.\n\nTrial  |  Phase\nTETON  |  3\n\nNote: old value_in_name stays')
    expect(markdownToPlain('| Footprint | 34 trials | 2 trials | (unverified)')).toBe('Footprint  |  34 trials  |  2 trials  |  (unverified)')
  })

  it('links a cited record without a URL to the URL in its key, else to the record over its asset tab', () => {
    expect(citationLink(cite(4, { url: undefined }), ORIGIN)).toBe('https://app.test/assets/treprostinil/clinical?rtab=clinical&record=NCT4')
    expect(citationLink(cite(5, { url: undefined, recordKey: 'az:press_release:https://az.com/pr/1.html' }), ORIGIN)).toBe('https://az.com/pr/1.html')
    expect(citationLink(cite(6, { url: undefined, recordKey: 'https://news.example/a' }), ORIGIN)).toBe('https://news.example/a')
  })
})

describe('conversation export', () => {
  const SECOND = msg('assistant', 'Approved in 2021 [1]. Unknown ref [9].', { citations: [cite(1, { title: 'Approval letter' })] })
  const MESSAGES = [msg('user', 'How did TETON-2 read out?'), ANSWER, msg('user', 'When was it   approved?'), SECOND, msg('user', 'Unanswered')]

  it('numbers footnotes once across the conversation, with title, date and Q/A blocks', () => {
    const md = conversationMarkdown('TETON readouts', MESSAGES, new Date(2026, 9, 24, 18, 5), ORIGIN)
    expect(md.startsWith('# TETON readouts\n\n_Asset AI conversation · exported 24 Oct 2026, 18:05 · 2 questions_')).toBe(true)
    expect(md).toContain('## Q1. How did TETON-2 read out?')
    expect(md).toContain('## Q2. When was it approved?')
    // The second answer's [1] becomes the 4th footnote; an uncited marker stays as written.
    expect(md).toContain('Approved in 2021 [^4]. Unknown ref [9].')
    expect(md).toContain('[^4]: Approval letter (ClinicalTrials.gov, 1 Sep 2025, Treprostinil). <https://example.org/r1>')
    expect(md.match(/^\[\^\d\]:/gm)).toHaveLength(4)
    expect(md).not.toContain('Unanswered')
  })

  it('includes card content: a comparison as a table', () => {
    const answer = msg('assistant', '', {
      cards: [{ type: 'comparison', title: 'Treprostinil vs Sotatercept', columns: [{ id: 'a', name: 'Treprostinil', company: '' }, { id: 'b', name: 'Sotatercept', company: '' }], rows: [{ label: 'Route', values: ['Inhaled', 'SC | injection'] }] }],
    })
    const md = conversationMarkdown('Compare', [msg('user', 'Compare them'), answer], new Date(2026, 0, 1), ORIGIN)
    expect(md).toContain('| | Treprostinil | Sotatercept |\n|---|---|---|\n| Route | Inhaled | SC \\| injection |')
  })

  it('names the file after the title and the day', () => {
    expect(transcriptFileName('TETON-2: readouts & “safety”!', new Date(2026, 9, 4), 'md')).toBe('asset-ai-teton-2-readouts-safety-2026-10-04.md')
    expect(transcriptFileName('***', new Date(2026, 9, 4), 'pdf')).toBe('asset-ai-chat-2026-10-04.pdf')
  })

  it('builds a PDF with the title, Q/A text, sources with links and page numbers (smoke)', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(readFileSync(join(process.cwd(), url.replace(/\?.*$/, '')))))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const long = msg('assistant', Array.from({ length: 80 }, (_, i) => `- Point ${i} with FEV1 ≥ 10% β-agonist [1]`).join('\n'), { citations: [cite(1)] })
      const blob = await buildConversationPdf('TETON readouts', [...MESSAGES, msg('user', 'More?'), long], new Date(2026, 9, 24), ORIGIN)
      const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))
      expect(text.startsWith('%PDF-')).toBe(true)
      expect(text).toContain('/Title (TETON readouts)')
      expect(fetchMock.mock.calls.map(([u]) => u).join(' ')).toMatch(/Inter-Regular\.ttf.*Inter-Bold\.ttf/)
      expect(text.match(/\/FontName \/Inter\b/g)).toHaveLength(2)
      expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1)
      // Source links are clickable link annotations.
      expect(text).toContain('/URI (https://example.org/r1)')
      expect(text).toContain('/URI (https://app.test/assets/treprostinil/regulatory?rtab=regulatory&record=fda%3A1)')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('save to journey', () => {
  it('finds the assets an answer is about, most cited first', () => {
    expect(answerAssets(ANSWER)).toEqual([
      { id: 'treprostinil', name: 'Treprostinil' },
      { id: 'nintedanib', name: 'Nintedanib' },
    ])
    expect(answerAssets(msg('assistant', 'x', { cards: [{ type: 'job', jobId: 'j', assetId: 'sota', assetName: 'Sotatercept' }] }))).toEqual([{ id: 'sota', name: 'Sotatercept' }])
  })

  it('prefills the note: title from the question, text with source refs, the asset’s records and a category', () => {
    const note = noteFromAnswer('How did   TETON-2 read out?', ANSWER, 'treprostinil', ORIGIN)
    expect(note.title).toBe('How did TETON-2 read out?')
    expect(note.text).toContain('TETON-2 met its primary endpoint [1].')
    expect(note.text).toContain('Sources:\n[1] Record 1')
    expect(note.sources).toEqual([
      { collection: 'trial_records', record_key: 'NCT1' },
      { collection: 'fda_records', record_key: 'fda:1' },
    ])
    expect(note.category).toBe('clinical')
    expect(noteFromAnswer(null, ANSWER, 'nintedanib', ORIGIN)).toMatchObject({ title: 'TETON-2 met its primary endpoint [1].', sources: [{ record_key: 'NCT3' }] })
    expect(noteFromAnswer('q', msg('assistant', 'x'.repeat(5000)), 'treprostinil', ORIGIN).text).toHaveLength(4000)
    const newsAndTrial = msg('assistant', 'x', { citations: [cite(1, { collection: 'articles', tab: 'news' }), cite(2)] })
    expect(noteFromAnswer('q', newsAndTrial, 'treprostinil', ORIGIN).category).toBe('clinical')
    expect(noteFromAnswer('q', msg('assistant', 'x', { citations: [cite(1, { collection: 'articles', tab: 'news' })] }), 'treprostinil', ORIGIN).category).toBe('company')
  })
})

describe('history search', () => {
  const s = (id: string, title: string, assetId: string | null = null) => ({ id, title, assetId, createdAt: '', updatedAt: '' })
  it('matches every word against the title and the asset name, ignoring case', () => {
    const list = [s('1', 'TETON readouts', 'trep'), s('2', 'Patent cliff', 'nint'), s('3', '')]
    const names = (id: string) => ({ trep: 'Treprostinil', nint: 'Nintedanib' })[id]
    expect(filterSessions(list, '', names).map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(filterSessions(list, 'teton', names).map((x) => x.id)).toEqual(['1'])
    expect(filterSessions(list, 'nintedanib cliff', names).map((x) => x.id)).toEqual(['2'])
    expect(filterSessions(list, 'new chat', names).map((x) => x.id)).toEqual(['3'])
    expect(filterSessions(list, 'zzz', names)).toEqual([])
  })
})
