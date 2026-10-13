import { csvField } from '@/features/journey/export/csv'
import { exportDay } from '@/features/journey/export/model'
import { dateCell, XLSX_TYPE } from '@/features/journey/export/xlsx'

/** One exported column; `date` cells hold `YYYY-MM-DD` / `YYYY-MM` / `YYYY` text, `link` cells a URL. */
export interface ExportColumn {
  header: string
  kind?: 'date' | 'link'
}

/** A table as shown (records tab, Home card), for CSV and Excel: rows of plain text in `columns` order. */
export interface ExportTable {
  /** Sheet name of the rows (Excel allows 31 characters, no `[]:*?/\`). */
  sheet: string
  columns: ExportColumn[]
  rows: string[][]
  /** The About sheet: what was exported, from where, with which filters. The export time is added. */
  about: [string, string | number][]
}

export type TableFormat = 'csv' | 'xlsx'

/** `<stem>-<YYYY-MM-DD>.<ext>`, e.g. `treprostinil-clinical-2026-10-13.csv`; the stem keeps letters, digits, `.`, `_` and `-`. */
export const tableFileName = (stem: string, at: Date, ext: TableFormat) => `${stem.replace(/[^\w.-]+/g, '-')}-${exportDay(at)}.${ext}`

/** The rows as CSV (RFC 4180, CRLF rows, formula guard), with a UTF-8 BOM so Excel reads accents right. */
export function tableCsv(t: ExportTable): string {
  const lines = [t.columns.map((c) => c.header), ...t.rows].map((cells) => cells.map(csvField).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Characters wide: the longest of the header and the first 200 values, kept between 10 and 60. */
function width(t: ExportTable, i: number): number {
  const longest = Math.max(t.columns[i]!.header.length, ...t.rows.slice(0, 200).map((r) => (r[i] ?? '').length))
  return Math.min(60, Math.max(10, longest + 2))
}

/**
 * The rows as an Excel workbook: a sheet with a bold, frozen header row, an autofilter, real date cells and
 * clickable links, and an "About" sheet. ExcelJS is loaded on demand.
 */
export async function tableXlsx(t: ExportTable, exportedAt: Date): Promise<Blob> {
  const mod = await import('exceljs')
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'PharmaEdge'
  wb.created = exportedAt

  const ws = wb.addWorksheet(t.sheet.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = t.columns.map((c, i) => ({ header: c.header, width: c.kind === 'date' ? 12 : width(t, i) }))
  ws.getRow(1).font = { bold: true }
  for (const cells of t.rows) {
    const row = ws.addRow(
      cells.map((v, i) => {
        const kind = t.columns[i]?.kind
        if (kind === 'date') return dateCell(v)?.value ?? v
        if (kind === 'link' && v) return { text: v, hyperlink: v }
        return v
      }),
    )
    row.alignment = { vertical: 'top' }
    t.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      if (c.kind === 'date') {
        const d = dateCell(cells[i] ?? '')
        if (d) cell.numFmt = d.numFmt
      } else if (c.kind === 'link' && cells[i]) cell.font = { color: { argb: 'FF2347D9' }, underline: true }
    })
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: t.rows.length + 1, column: t.columns.length } }

  const about = wb.addWorksheet('About')
  about.columns = [{ width: 16 }, { width: 70 }]
  // Excel dates carry no zone: write the local wall-clock time.
  about.addRows([...t.about, ['Exported', new Date(exportedAt.getTime() - exportedAt.getTimezoneOffset() * 60_000)]])
  about.getColumn(1).font = { bold: true }
  about.getColumn(2).alignment = { horizontal: 'left' }
  about.getCell(`B${t.about.length + 1}`).numFmt = 'yyyy-mm-dd hh:mm'

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_TYPE })
}

/** The file for one format. */
export async function buildTable(t: ExportTable, format: TableFormat, exportedAt: Date): Promise<Blob> {
  return format === 'csv' ? new Blob([tableCsv(t)], { type: 'text/csv;charset=utf-8' }) : tableXlsx(t, exportedAt)
}
