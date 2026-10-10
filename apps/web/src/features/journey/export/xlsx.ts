import { COLUMNS, exportRows, filtersLabel, ORDER_LABEL, SCOPE_LABEL, type ExportContext } from './model'

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Column widths (characters), in `COLUMNS` order. */
const WIDTHS = [12, 10, 60, 13, 18, 13, 22, 12, 70, 40, 46]

/** `YYYY-MM-DD` / `YYYY-MM` / `YYYY` → a UTC-midnight date and the number format that shows its precision. */
function dateCell(iso: string): { value: Date; numFmt: string } | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(iso)
  if (!m) return null
  const value = new Date(Date.UTC(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1)))
  return { value, numFmt: m[3] ? 'yyyy-mm-dd' : m[2] ? 'yyyy-mm' : 'yyyy' }
}

/**
 * The shown events as an Excel workbook: a "Journey" sheet (bold, frozen header row, autofilter, real date cells,
 * clickable event links) and an "About" sheet saying what was exported. ExcelJS is loaded on demand.
 */
export async function buildXlsx(ctx: ExportContext): Promise<Blob> {
  const mod = await import('exceljs')
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PharmaEdge'
  wb.created = ctx.exportedAt

  const ws = wb.addWorksheet('Journey', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUMNS.map((header, i) => ({ header, width: WIDTHS[i] }))
  ws.getRow(1).font = { bold: true }
  const rows = exportRows(ctx)
  for (const r of rows) {
    const date = dateCell(r.date)
    const row = ws.addRow([date?.value ?? r.date, r.expected, r.title, r.category, r.type, r.significance, r.indications, r.branch, r.summary, r.sources, { text: r.link, hyperlink: r.link }])
    if (date) row.getCell(1).numFmt = date.numFmt
    row.alignment = { vertical: 'top' }
    // Title and summary wrap; the long Sources list stays on one line so rows keep a readable height.
    for (const c of [3, 9]) row.getCell(c).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(11).font = { color: { argb: 'FF2347D9' }, underline: true }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: COLUMNS.length } }

  const about = wb.addWorksheet('About')
  about.columns = [{ width: 16 }, { width: 70 }]
  about.addRows([
    ['Asset', ctx.asset.company ? `${ctx.asset.name} (${ctx.asset.company})` : ctx.asset.name],
    ['Asset id', ctx.asset.id],
    // Excel dates carry no zone: write the local wall-clock time.
    ['Exported', new Date(ctx.exportedAt.getTime() - ctx.exportedAt.getTimezoneOffset() * 60_000)],
    ['Scope', SCOPE_LABEL[ctx.scope]],
    ['Filters', filtersLabel(ctx.filters)],
    ['Order', ORDER_LABEL[ctx.order]],
    ['Events', rows.length],
  ])
  about.getColumn(1).font = { bold: true }
  about.getCell('B3').numFmt = 'yyyy-mm-dd hh:mm'
  about.getCell('B7').alignment = { horizontal: 'left' }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_TYPE })
}
