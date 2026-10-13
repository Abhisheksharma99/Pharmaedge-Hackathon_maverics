import { ChevronDown, Download, FileSpreadsheet, LoaderCircle, Sheet, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { BTN_SM } from '@/features/journey/controls'
import type { ExportTable, TableFormat } from '@/lib/table-export'

/** What a table export produces: the table, the file name stem (`<asset>-<tab>`), the success toast and an optional note. */
export interface TableExportResult {
  table: ExportTable
  stem: string
  done: string
  note?: string
}

const FORMATS: { format: TableFormat; label: string; hint: string; icon: LucideIcon }[] = [
  { format: 'csv', label: 'CSV', hint: '.csv · any spreadsheet or script', icon: Sheet },
  { format: 'xlsx', label: 'Excel workbook', hint: '.xlsx · filterable, with an About sheet', icon: FileSpreadsheet },
]

const ITEM = 'items-start gap-[10px] rounded-[8px] px-[10px] py-[7px] [&_svg]:mt-[2px]'

/**
 * A table's "Export" menu (CSV / Excel) for what a records tab or card shows. `title` and `detail` head the menu
 * ("Exports the 128 records matching" · "Search “tyvaso” · Phase: Phase 3"); `build` gathers the rows on click.
 */
export function TableExportMenu({ title, detail, disabled = false, build }: { title: string; detail?: string; disabled?: boolean; build: () => Promise<TableExportResult> }) {
  const [busy, setBusy] = useState(false)

  const run = async (format: TableFormat) => {
    setBusy(true)
    try {
      const exportedAt = new Date()
      // The builders (and through them ExcelJS) load on the first export, not with the app.
      const [{ buildTable, tableFileName }, { downloadBlob }, result] = await Promise.all([import('@/lib/table-export'), import('@/features/journey/export/build'), build()])
      const filename = tableFileName(result.stem, exportedAt, format)
      downloadBlob(await buildTable(result.table, format, exportedAt), filename)
      toast.success(result.done, { description: result.note ? `${filename} · ${result.note}` : filename })
    } catch (e) {
      toast.error('The export failed', { description: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || busy}>
        <Button variant="outline" size="sm" className={BTN_SM}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          {busy ? 'Exporting…' : 'Export'}
          <ChevronDown className="-mr-[2px] size-[13px] text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} collisionPadding={16} className="w-[288px] max-w-[calc(100vw-32px)] rounded-[12px] border border-border p-[6px] shadow-popover ring-0">
        <DropdownMenuLabel className="flex flex-col gap-[2px] px-[10px] pt-[6px] pb-[8px] text-[13px] text-foreground">
          <b className="font-semibold">{title}</b>
          {detail && <span className="text-[12px] leading-[17px] font-normal text-muted-foreground">{detail}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-[-6px]" />
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.format} className={ITEM} onSelect={() => void run(f.format)}>
            <f.icon className="size-[15px] text-muted-foreground" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{f.label}</span>
              <span className="text-[12px] text-muted-foreground">{f.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
