import { exportRows, filtersLabel, ORDER_LABEL, SCOPE_LABEL, type ExportContext } from './model'

/** Typographic characters the built-in PDF fonts (WinAnsi) lack, spelled with ones they have. */
const PLAIN: Record<string, string> = { '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"', '–': '-', '—': '-', '‐': '-', '‑': '-', '−': '-', '…': '...', '•': '-', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '™': '(TM)', '\u2009': ' ', '\u202f': ' ' }

/**
 * Text the PDF's built-in Helvetica can draw: Latin-1 stays (é, à, ü, ±, µ…), common punctuation is spelled out, other
 * accented letters lose their accent (ő → o), anything else becomes "?".
 */
export function pdfText(s: string): string {
  let out = ''
  for (const ch of s.normalize('NFC')) {
    const code = ch.codePointAt(0)!
    if (code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out += ch
    else if (PLAIN[ch] !== undefined) out += PLAIN[ch]
    else {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '')
      out += /^[\x20-\x7e\xa0-\xff]+$/.test(base) ? base : code === 9 ? ' ' : '?'
    }
  }
  return out
}

/** "Oct 10, 2026, 14:05" in the viewer's locale and zone. */
const stamp = (d: Date) => d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * A printable report of the shown events: title, asset, company, export time, scope / filters / order line, then a
 * table grouped by year (date, title, category, significance, indications) with page numbers. jsPDF and its table
 * plugin are loaded on demand.
 */
export async function buildPdf(ctx: ExportContext): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const M = 40
  const rows = exportRows(ctx)
  const title = pdfText(`${ctx.asset.name}: asset journey`)
  doc.setProperties({ title, subject: 'Asset journey export', creator: 'PharmaEdge' })

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(16, 24, 40)
  doc.text(title, M, M + 8)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(71, 84, 103)
  const lines = [
    pdfText([ctx.asset.company && `Company: ${ctx.asset.company}`, `Asset id: ${ctx.asset.id}`, `Exported ${stamp(ctx.exportedAt)}`].filter(Boolean).join('   ·   ')),
    pdfText(`${SCOPE_LABEL[ctx.scope]}   ·   ${ORDER_LABEL[ctx.order]}   ·   Filters: ${filtersLabel(ctx.filters)}   ·   ${rows.length} event${rows.length === 1 ? '' : 's'}`),
  ].flatMap((l) => doc.splitTextToSize(l, width - 2 * M) as string[])
  doc.text(lines, M, M + 28, { lineHeightFactor: 1.4 })

  // One full-width row per year, then the year's events, in the journey's order.
  const body: (string | { content: string; colSpan: number; styles: object })[][] = []
  let year = ''
  for (const r of rows) {
    if (r.date.slice(0, 4) !== year) {
      year = r.date.slice(0, 4)
      body.push([{ content: year, colSpan: 5, styles: { fontStyle: 'bold', fontSize: 10.5, fillColor: [242, 244, 247], textColor: [16, 24, 40] } }])
    }
    body.push([r.expected === 'yes' ? `${r.date}\n(expected)` : r.date, pdfText(r.title), r.category, r.significance, pdfText(r.indications.replace(/; /g, ', '))])
  }

  autoTable(doc, {
    startY: M + 28 + lines.length * 14 + 10,
    margin: { left: M, right: M, top: M, bottom: M },
    head: [['Date', 'Title', 'Category', 'Significance', 'Indications']],
    body,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, overflow: 'linebreak', valign: 'top', lineColor: [228, 231, 236], lineWidth: 0.5, textColor: [52, 64, 84] },
    headStyles: { fillColor: [35, 71, 217], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 72 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 74 }, 3: { cellWidth: 72 }, 4: { cellWidth: 130 } },
  })

  const pages = doc.getNumberOfPages()
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(102, 112, 133)
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.text(pdfText(`${ctx.asset.name} · asset journey · ${SCOPE_LABEL[ctx.scope]}`), M, height - 20)
    doc.text(`Page ${i} of ${pages}`, width - M, height - 20, { align: 'right' })
  }
  return doc.output('blob')
}
