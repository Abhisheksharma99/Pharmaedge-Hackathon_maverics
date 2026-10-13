import type { jsPDF as JsPdf } from 'jspdf'
import interBoldUrl from './fonts/Inter-Bold.ttf?url'
import interRegularUrl from './fonts/Inter-Regular.ttf?url'
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

/**
 * The Unicode ranges kept in the bundled Inter subset (fonts/, OFL): Latin with its extensions and combining marks,
 * Greek, Cyrillic, general punctuation, super/subscripts, currency, letterlike symbols (™), arrows, math operators
 * (≥ ≤ ±), geometric shapes and ✓.
 */
const INTER_RANGES: [number, number][] = [
  [0x0000, 0x024f],
  [0x0300, 0x03ff],
  [0x0400, 0x04ff],
  [0x1e00, 0x1eff],
  [0x2000, 0x20cf],
  [0x2100, 0x214f],
  [0x2190, 0x22ff],
  [0x25a0, 0x25ff],
  [0x2713, 0x2713],
]
const inInter = (ch: string) => {
  const code = ch.codePointAt(0)!
  return INTER_RANGES.some(([lo, hi]) => code >= lo && code <= hi)
}

/**
 * Text the embedded Inter can draw: everything in its ranges stays (≥, β, –, ’, ®, ™…); full-width ASCII forms
 * (“（”, “：” from CJK sources) become their ASCII twins; other characters lose their accent or become "?".
 */
export function unicodeText(s: string): string {
  let out = ''
  for (const ch of s.normalize('NFC')) {
    const code = ch.codePointAt(0)!
    if (code === 9) out += ' '
    else if (inInter(ch)) out += ch
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0)
    else if (code === 0x3000) out += ' '
    else {
      const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      out += base && [...base].every(inInter) ? base : '?'
    }
  }
  return out
}

/** Base64 of a font file, in chunks (a spread of 90 kB of bytes would overflow the call stack). */
function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Embeds Inter Regular + Bold (bundled assets, fetched on the first PDF export) as the "Inter" family and returns the
 * family to use with its text filter; when the fonts can't be fetched, the built-in Helvetica with `pdfText`.
 */
export async function registerPdfFont(doc: JsPdf): Promise<{ font: string; text: (s: string) => string }> {
  try {
    const files = await Promise.all(
      [interRegularUrl, interBoldUrl].map(async (url) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`${url}: ${res.status}`)
        return base64(await res.arrayBuffer())
      }),
    )
    doc.addFileToVFS('Inter-Regular.ttf', files[0]!)
    doc.addFont('Inter-Regular.ttf', 'Inter', 'normal')
    doc.addFileToVFS('Inter-Bold.ttf', files[1]!)
    doc.addFont('Inter-Bold.ttf', 'Inter', 'bold')
    return { font: 'Inter', text: unicodeText }
  } catch {
    return { font: 'helvetica', text: pdfText }
  }
}

/** "Oct 10, 2026, 14:05" in the viewer's locale and zone. */
const stamp = (d: Date) => d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * A printable report of the shown events: title, asset, company, export time, scope / filters / order line, then a
 * table grouped by year (date, title, category, significance, indications) with page numbers, set in the embedded
 * Inter so non-Latin-1 text (≥, β, ’, ™…) prints. jsPDF, its table plugin and the fonts are loaded on demand.
 */
export async function buildPdf(ctx: ExportContext): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  /** The chosen font's text filter. */
  const { font, text: t } = await registerPdfFont(doc)
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const M = 40
  const rows = exportRows(ctx)
  const title = t(`${ctx.asset.name}: asset journey`)
  doc.setProperties({ title, subject: 'Asset journey export', creator: 'PharmaEdge' })

  doc.setFont(font, 'bold').setFontSize(18).setTextColor(16, 24, 40)
  doc.text(title, M, M + 8)
  doc.setFont(font, 'normal').setFontSize(10).setTextColor(71, 84, 103)
  const lines = [
    t([ctx.asset.company && `Company: ${ctx.asset.company}`, `Asset id: ${ctx.asset.id}`, `Exported ${stamp(ctx.exportedAt)}`].filter(Boolean).join('   ·   ')),
    t(`${SCOPE_LABEL[ctx.scope]}   ·   ${ORDER_LABEL[ctx.order]}   ·   Filters: ${filtersLabel(ctx.filters)}   ·   ${rows.length} event${rows.length === 1 ? '' : 's'}`),
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
    body.push([r.expected === 'yes' ? `${r.date}\n(expected)` : r.date, t(r.title), t(r.category), t(r.significance), t(r.indications.replace(/; /g, ', '))])
  }

  autoTable(doc, {
    startY: M + 28 + lines.length * 14 + 10,
    margin: { left: M, right: M, top: M, bottom: M },
    head: [['Date', 'Title', 'Category', 'Significance', 'Indications']],
    body,
    theme: 'grid',
    styles: { font, fontSize: 9, cellPadding: 5, overflow: 'linebreak', valign: 'top', lineColor: [228, 231, 236], lineWidth: 0.5, textColor: [52, 64, 84] },
    headStyles: { fillColor: [35, 71, 217], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 72 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 74 }, 3: { cellWidth: 72 }, 4: { cellWidth: 130 } },
  })

  const pages = doc.getNumberOfPages()
  doc.setFont(font, 'normal').setFontSize(8.5).setTextColor(102, 112, 133)
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.text(t(`${ctx.asset.name} · asset journey · ${SCOPE_LABEL[ctx.scope]}`), M, height - 20)
    doc.text(`Page ${i} of ${pages}`, width - M, height - 20, { align: 'right' })
  }
  return doc.output('blob')
}
