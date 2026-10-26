import { formatDate } from '@/lib/format'
import type { Card, ChatMessage, Citation } from './api'
import { viewPath } from './navigation'

/** "[1]", "[1][3]" (two markers) and "[1, 3]", as in citations.ts. */
const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g

/** One question and its answer (an answer without a question before it has `question: null`). */
export interface QaPair {
  question: string | null
  answer: ChatMessage
}

/** Pairs each answer with the question asked just before it; questions still unanswered are left out. */
export function qaPairs(messages: ChatMessage[]): QaPair[] {
  const pairs: QaPair[] = []
  let question: string | null = null
  for (const m of messages) {
    if (m.role === 'user') question = m.content
    else {
      pairs.push({ question, answer: m })
      question = null
    }
  }
  return pairs
}

/**
 * Where a cited record lives: its source URL (or the one its record key carries, as news and company records' keys
 * do), else the record opened over its asset tab in this app.
 */
export function citationLink(c: Citation, origin: string): string {
  return c.url || /https?:\/\/\S+$/.exec(c.recordKey)?.[0] || `${origin}${viewPath({ assetId: c.assetId, tab: c.tab, record: { tab: c.tab, key: c.recordKey } })}`
}

/** "TETON-2 (ClinicalTrials.gov, 1 Sep 2025, Treprostinil)" — a citation as one line of text. */
export function citationLabel(c: Citation): string {
  const meta = [c.source, c.date && formatDate(c.date), c.assetName].filter(Boolean).join(', ')
  return meta ? `${c.title} (${meta})` : c.title
}

/** Rewrites the answer's markers through `to` (n → replacement), leaving markers of uncited numbers as they are. */
function mapMarkers(text: string, cited: ReadonlySet<number>, to: (n: number) => string): string {
  return text.replace(MARKER, (_, nums: string) =>
    nums
      .split(',')
      .map(Number)
      .map((n) => (cited.has(n) ? to(n) : `[${n}]`))
      .join(''),
  )
}

/** A card as markdown: the comparison table and the timeline's events in full, other cards as a line. */
export function cardMarkdown(card: Card): string {
  switch (card.type) {
    case 'comparison': {
      const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      return [
        `**${card.title}**`,
        '',
        `| | ${card.columns.map((c) => cell(c.name)).join(' | ')} |`,
        `|---|${card.columns.map(() => '---').join('|')}|`,
        ...card.rows.map((r) => `| ${cell(r.label)} | ${r.values.map(cell).join(' | ')} |`),
      ].join('\n')
    }
    case 'timeline':
      return [`**${card.title}**`, '', ...card.events.map((e) => `- ${formatDate(e.date)}: ${e.title}${e.is_milestone ? ' (milestone)' : ''}`)].join('\n')
    case 'identity':
      return `_Asset identity card: ${String(card.identity.name ?? '')}_`
    case 'job':
      return `_Crawl started for ${card.assetName}_`
    case 'canvas':
      return `_Journey canvas: ${card.title} (${card.nodes} nodes)_`
    case 'story':
      return `_Journey story: ${card.title} (${card.events} events)_`
  }
}

/** The answer's markdown with its cards after it. */
const answerBody = (m: ChatMessage) => [m.content.trim(), ...m.cards.map(cardMarkdown)].filter(Boolean).join('\n\n')

const sortedCitations = (m: ChatMessage) => [...m.citations].sort((a, b) => a.n - b.n)

/** A footnote definition: "[^3]: TETON-2 (ClinicalTrials.gov, 1 Sep 2025, Treprostinil). <https://…>" */
const footnote = (label: number, c: Citation, origin: string) => `[^${label}]: ${citationLabel(c)}. <${citationLink(c, origin)}>`

/** One answer as Markdown: its citation markers become footnotes ([^1]) defined under it, with source links. */
export function answerMarkdown(m: ChatMessage, origin: string): string {
  const cited = new Set(m.citations.map((c) => c.n))
  const body = mapMarkers(answerBody(m), cited, (n) => `[^${n}]`)
  const notes = sortedCitations(m).map((c) => footnote(c.n, c, origin))
  return notes.length ? `${body}\n\n${notes.join('\n')}\n` : `${body}\n`
}

/** Markdown reduced to readable plain text: no emphasis, headings, code ticks or table rules; links keep their URL. */
export function markdownToPlain(md: string): string {
  return md
    .split('\n')
    .filter((line) => !/^\s*```/.test(line) && !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line))
    .map((line) => {
      let l = line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^(\s*)>\s?/, '$1')
        .replace(/^(\s*)[-*+]\s+/, '$1• ')
      // A table row; text the answer check appended after its closing pipe ("| … | (unverified)") stays as a last cell.
      if (/^\s*\|.*\|/.test(l)) {
        l = l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim()).filter((c, i, all) => c || i < all.length - 1).join('  |  ')
      }
      return l
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, text: string, url: string) => (text === url ? url : `${text} (${url})`))
        .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
        .replace(/(^|[^\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?!\w)/g, '$1$2')
        .replace(/(^|\W)_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g, '$1$2')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\\([\\|*_`[\]#])/g, '$1')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One answer as plain text: [n] markers kept, then a numbered "Sources" list with links. */
export function answerPlainText(m: ChatMessage, origin: string): string {
  const body = markdownToPlain(answerBody(m))
  const sources = sortedCitations(m).map((c) => `[${c.n}] ${citationLabel(c)}. ${citationLink(c, origin)}`)
  return sources.length ? `${body}\n\nSources:\n${sources.join('\n')}` : body
}

/** "24 Oct 2026, 18:55" in the viewer's zone. */
export const exportStamp = (d: Date) =>
  `${formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** A whole conversation, numbered once: answer k's citation n gets the next free number, so footnotes never clash. */
export interface NumberedConversation {
  pairs: { question: string | null; body: string }[]
  /** Global number → citation, in order. */
  notes: { label: number; citation: Citation }[]
}

/** Renumbers every answer's citations into one sequence (1…N across the conversation); `body` uses `marker(label)`. */
export function numberConversation(messages: ChatMessage[], marker: (label: number) => string): NumberedConversation {
  const notes: NumberedConversation['notes'] = []
  const pairs = qaPairs(messages).map(({ question, answer }) => {
    const labels = new Map<number, number>()
    for (const c of sortedCitations(answer)) {
      labels.set(c.n, notes.length + 1)
      notes.push({ label: notes.length + 1, citation: c })
    }
    return { question, body: mapMarkers(answerBody(answer), new Set(labels.keys()), (n) => marker(labels.get(n)!)) }
  })
  return { pairs, notes }
}

/** The conversation as a Markdown document: title, export date, Q/A blocks, then every source as a footnote. */
export function conversationMarkdown(title: string, messages: ChatMessage[], exportedAt: Date, origin: string): string {
  const { pairs, notes } = numberConversation(messages, (label) => `[^${label}]`)
  const out = [
    `# ${title}`,
    '',
    `_Asset AI conversation · exported ${exportStamp(exportedAt)} · ${pairs.length} question${pairs.length === 1 ? '' : 's'}_`,
  ]
  pairs.forEach((p, i) => {
    out.push('', `## Q${i + 1}. ${(p.question ?? 'Asset AI').replace(/\s+/g, ' ').trim()}`, '', p.body || '_No answer text._')
  })
  if (notes.length) out.push('', '---', '', ...notes.map((n) => footnote(n.label, n.citation, origin)))
  return `${out.join('\n')}\n`
}

/** `asset-ai-teton-readouts-2026-10-24.md` */
export function transcriptFileName(title: string, exportedAt: Date, ext: 'md' | 'pdf'): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60).replace(/-+$/, '') || 'chat'
  const day = `${exportedAt.getFullYear()}-${String(exportedAt.getMonth() + 1).padStart(2, '0')}-${String(exportedAt.getDate()).padStart(2, '0')}`
  return `asset-ai-${slug}-${day}.${ext}`
}

/** The assets an answer is about, most cited first: its citations' assets, then its cards' assets. */
export function answerAssets(m: ChatMessage): { id: string; name: string }[] {
  const counts = new Map<string, { id: string; name: string; n: number }>()
  for (const c of m.citations) {
    const a = counts.get(c.assetId) ?? { id: c.assetId, name: c.assetName || c.assetId, n: 0 }
    a.n++
    counts.set(c.assetId, a)
  }
  for (const card of m.cards) {
    const id = 'assetId' in card ? card.assetId : null
    if (id && !counts.has(id)) counts.set(id, { id, name: card.type === 'job' ? card.assetName : id, n: 0 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map(({ id, name }) => ({ id, name }))
}

const NOTE_TITLE_MAX = 200
const NOTE_TEXT_MAX = 4000
const NOTE_SOURCES_MAX = 20
const CATEGORY_BY_TAB: Record<string, 'regulatory' | 'clinical' | 'ip'> = { clinical: 'clinical', regulatory: 'regulatory', patents: 'ip' }

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`)

/**
 * A team note prefilled from an answer, for one asset: title from the question, text from the answer as plain text
 * with its source refs, the asset's cited records as sources, and a category from what those records mostly are.
 */
export function noteFromAnswer(question: string | null, m: ChatMessage, assetId: string, origin: string) {
  const own = m.citations.filter((c) => c.assetId === assetId)
  const tabs = new Map<string, number>()
  // Only tabs that name a category count (news and company records fall back to "company").
  for (const c of own) if (CATEGORY_BY_TAB[c.tab]) tabs.set(c.tab, (tabs.get(c.tab) ?? 0) + 1)
  const topTab = [...tabs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const firstLine = markdownToPlain(m.content).split('\n').find((l) => l.trim()) ?? 'Asset AI answer'
  return {
    title: clip((question ?? firstLine).replace(/\s+/g, ' ').trim(), NOTE_TITLE_MAX),
    text: clip(answerPlainText(m, origin), NOTE_TEXT_MAX),
    category: (topTab && CATEGORY_BY_TAB[topTab]) || (own.length ? 'company' : 'clinical'),
    sources: [...new Map(own.map((c) => [`${c.collection}|${c.recordKey}`, { collection: c.collection, record_key: c.recordKey }])).values()]
      .filter((s) => s.record_key.length <= 2000)
      .slice(0, NOTE_SOURCES_MAX),
  } as const
}
