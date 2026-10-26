import { registerPdfFont } from '@/features/journey/export/pdf'
import type { ChatMessage } from './api'
import { citationLabel, citationLink, exportStamp, markdownToPlain, numberConversation } from './transcript'

const M = 48
const INK: [number, number, number] = [16, 24, 40]
const BODY: [number, number, number] = [52, 64, 84]
const MUTED: [number, number, number] = [102, 112, 133]
const PRIMARY: [number, number, number] = [35, 71, 217]

/**
 * The conversation as a printable A4 PDF: title, export date, each question with its answer (plain text, bullets
 * indented, citation markers renumbered across the conversation), then the numbered sources with their links, and
 * page numbers. jsPDF loads on demand; the text is set in the journey export's embedded Inter (so ≥, β, ’… print).
 */
export async function buildConversationPdf(title: string, messages: ChatMessage[], exportedAt: Date, origin: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const { font, text: t } = await registerPdfFont(doc)
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const inner = width - 2 * M
  const bottom = height - M - 14
  let y = M

  /** Starts a new page when `h` more points don't fit. */
  const room = (h: number) => {
    if (y + h > bottom) {
      doc.addPage()
      y = M
    }
  }
  /** Wrapped lines at `x`, breaking across pages line by line. */
  const para = (s: string, { size = 10, style = 'normal', color = BODY, x = M, gap = 4 }: { size?: number; style?: string; color?: [number, number, number]; x?: number; gap?: number } = {}) => {
    doc.setFont(font, style).setFontSize(size).setTextColor(...color)
    const lh = size * 1.4
    for (const line of doc.splitTextToSize(t(s), inner - (x - M)) as string[]) {
      room(lh)
      doc.text(line, x, y + size)
      y += lh
    }
    y += gap
  }

  const { pairs, notes } = numberConversation(messages, (label) => `[${label}]`)
  doc.setProperties({ title: t(title), subject: 'Asset AI conversation', creator: 'PharmaEdge' })
  para(title, { size: 18, style: 'bold', color: INK, gap: 2 })
  para(`Asset AI conversation · exported ${exportStamp(exportedAt)} · ${pairs.length} question${pairs.length === 1 ? '' : 's'}`, { size: 9.5, color: MUTED, gap: 10 })
  doc.setDrawColor(228, 231, 236).setLineWidth(0.75).line(M, y, width - M, y)
  y += 14

  pairs.forEach((p, i) => {
    room(48)
    para(`Q${i + 1}.  ${(p.question ?? 'Asset AI').replace(/\s+/g, ' ').trim()}`, { size: 11.5, style: 'bold', color: PRIMARY, gap: 6 })
    for (const line of (markdownToPlain(p.body) || 'No answer text.').split('\n')) {
      if (!line.trim()) {
        y += 4
        continue
      }
      const bullet = /^(\s*)• (.*)$/.exec(line)
      if (bullet) {
        const x = M + 10 + Math.min(bullet[1]!.length, 6) * 4
        doc.setFont(font, 'normal').setFontSize(10).setTextColor(...BODY)
        room(14)
        doc.text(t('•'), x, y + 10)
        para(bullet[2]!, { x: x + 10, gap: 1 })
      } else para(line, { gap: 1 })
    }
    y += 14
  })

  if (notes.length) {
    room(40)
    doc.setDrawColor(228, 231, 236).line(M, y, width - M, y)
    y += 12
    para('Sources', { size: 12, style: 'bold', color: INK, gap: 4 })
    const HANG = 24
    for (const { label, citation } of notes) {
      const url = citationLink(citation, origin)
      doc.setFont(font, 'normal').setFontSize(9.5)
      const head = doc.splitTextToSize(t(citationLabel(citation)), inner - HANG) as string[]
      doc.setFontSize(8.5)
      const link = doc.splitTextToSize(url, inner - HANG) as string[]
      // A source and its link stay on one page.
      room(head.length * 13.3 + link.length * 12)
      doc.setFontSize(9.5).setTextColor(...BODY)
      doc.text(`[${label}]`, M, y + 9.5)
      para(head.join(' '), { size: 9.5, x: M + HANG, gap: 0 })
      doc.setFont(font, 'normal').setFontSize(8.5).setTextColor(...PRIMARY)
      for (const line of link) {
        room(12)
        doc.textWithLink(line, M + HANG, y + 8.5, { url })
        y += 12
      }
      y += 5
    }
  }

  const pages = doc.getNumberOfPages()
  doc.setFont(font, 'normal').setFontSize(8.5).setTextColor(...MUTED)
  const footer = t(`${title} · Asset AI`)
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.text(doc.splitTextToSize(footer, inner - 80)[0] as string, M, height - 24)
    doc.text(`Page ${i} of ${pages}`, width - M, height - 24, { align: 'right' })
  }
  return doc.output('blob')
}
