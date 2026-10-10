import { COLUMNS, exportRows, rowCells, type ExportContext } from './model'

/** Excel would run a cell starting with = + - @ (or a tab / CR) as a formula: such text is kept literal with a leading '. */
const FORMULA = /^[=+\-@\t\r]/

/** One RFC 4180 field: quoted when it holds a comma, quote, CR or LF, with inner quotes doubled. */
export function csvField(value: string): string {
  const v = FORMULA.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** The shown events as CSV (RFC 4180, CRLF rows), with a UTF-8 BOM so Excel reads accents ("Sàrl") right. */
export function toCsv(ctx: ExportContext): string {
  const lines = [COLUMNS as readonly string[], ...exportRows(ctx).map(rowCells)].map((cells) => cells.map(csvField).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}
