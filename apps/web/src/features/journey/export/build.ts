import { toCsv } from './csv'
import { toIcs } from './ics'
import { toJson } from './json'
import { exportFileName, type ExportContext, type ExportFormat } from './model'
import { buildPdf } from './pdf'
import { buildXlsx } from './xlsx'

/** The file for one format; the Excel and PDF libraries load on first use. */
export async function buildExport(format: ExportFormat, ctx: ExportContext): Promise<{ blob: Blob; filename: string }> {
  const filename = exportFileName(ctx, format)
  switch (format) {
    case 'csv':
      return { blob: new Blob([toCsv(ctx)], { type: 'text/csv;charset=utf-8' }), filename }
    case 'json':
      return { blob: new Blob([toJson(ctx)], { type: 'application/json' }), filename }
    case 'ics':
      return { blob: new Blob([toIcs(ctx)], { type: 'text/calendar;charset=utf-8' }), filename }
    case 'xlsx':
      return { blob: await buildXlsx(ctx), filename }
    case 'pdf':
      return { blob: await buildPdf(ctx), filename }
  }
}

/** Stamps a context with the export time and this page's origin (for the event links). */
export const stampNow = (ctx: Omit<ExportContext, 'exportedAt' | 'origin'>): ExportContext => ({ ...ctx, exportedAt: new Date(), origin: window.location.origin })

/** Saves a blob through a temporary link. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
