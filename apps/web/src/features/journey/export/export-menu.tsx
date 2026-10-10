import { CalendarPlus, ChevronDown, Download, FileBraces, FileSpreadsheet, FileText, LoaderCircle, Sheet, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { todayIso } from '@/lib/dates'
import { BTN_SM } from '../controls'
import { filtersLabel, ORDER_LABEL, SCOPE_LABEL, upcomingMilestones, type ExportContext, type ExportFormat } from './model'

const FORMATS: { format: ExportFormat; label: string; hint: string; icon: LucideIcon }[] = [
  { format: 'csv', label: 'CSV', hint: '.csv · any spreadsheet or script', icon: Sheet },
  { format: 'xlsx', label: 'Excel workbook', hint: '.xlsx · filterable, with an About sheet', icon: FileSpreadsheet },
  { format: 'json', label: 'JSON', hint: '.json · every event field and source', icon: FileBraces },
  { format: 'pdf', label: 'PDF report', hint: '.pdf · printable, grouped by year', icon: FileText },
]

const ITEM = 'items-start gap-[10px] rounded-[8px] px-[10px] py-[7px] [&_svg]:mt-[2px]'

/**
 * "Export" in the journey header: what the journey shows right now (scope, filters, order) as CSV, Excel, JSON, a PDF
 * report, or the upcoming milestones as a calendar. `ctx` leaves out the export time and origin, set on click;
 * `disabled` while the shown events are still loading (or are the previous scope's, kept on screen).
 */
export function ExportMenu({ ctx, disabled = false }: { ctx: Omit<ExportContext, 'exportedAt' | 'origin'>; disabled?: boolean }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const n = ctx.events.length
  const upcoming = upcomingMilestones(ctx.events, todayIso()).length

  const run = async (format: ExportFormat) => {
    setBusy(format)
    try {
      // The builders (and through them ExcelJS / jsPDF) load on the first export, not with the app.
      const { buildExport, downloadBlob, stampNow } = await import('./build')
      const { blob, filename } = await buildExport(format, stampNow(ctx))
      downloadBlob(blob, filename)
      const what = format === 'ics' ? `${upcoming} upcoming milestone${upcoming === 1 ? '' : 's'}` : `${n} event${n === 1 ? '' : 's'}`
      toast.success(`Exported ${what}`, { description: filename })
    } catch (e) {
      toast.error('The export failed', { description: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || !!busy || n === 0}>
        <Button variant="outline" size="sm" className={BTN_SM}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          {busy ? 'Exporting…' : 'Export'}
          <ChevronDown className="-mr-[2px] size-[13px] text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} collisionPadding={16} className="w-[288px] max-w-[calc(100vw-32px)] rounded-[12px] border border-border p-[6px] shadow-popover ring-0">
        <DropdownMenuLabel className="flex flex-col gap-[2px] px-[10px] pt-[6px] pb-[8px] text-[13px] text-foreground">
          <b className="font-semibold">
            Exports the {n} event{n === 1 ? '' : 's'} shown
          </b>
          <span className="text-[12px] leading-[17px] font-normal text-muted-foreground">
            {SCOPE_LABEL[ctx.scope]} · {ORDER_LABEL[ctx.order].toLowerCase()} · filters: {filtersLabel(ctx.filters).replace(/^None$/, 'none')}
          </span>
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
        <DropdownMenuSeparator className="mx-[-6px]" />
        <DropdownMenuItem className={ITEM} disabled={upcoming === 0} onSelect={() => void run('ics')}>
          <CalendarPlus className="size-[15px] text-muted-foreground" aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">Calendar of upcoming milestones</span>
            <span className="text-[12px] text-muted-foreground">
              .ics · {upcoming ? `${upcoming} expected milestone${upcoming === 1 ? '' : 's'} ahead` : 'no expected milestones ahead'}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
