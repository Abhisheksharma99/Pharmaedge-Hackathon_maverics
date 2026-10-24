import { Ellipsis, FileImage, Maximize2, Sheet } from 'lucide-react'
import { useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { todayIso } from '@/lib/dates'
import type { CardData } from './card-data'
import { cardPng, chartSvg, fileStem } from './card-png'

const ITEM = 'gap-[10px] rounded-[8px] px-[10px] py-[7px] text-[13px] [&_svg]:size-[15px] [&_svg]:text-muted-foreground'

/** The card as CSV: its chart's current series, one row per drawn mark. */
async function downloadCardCsv(data: CardData, title: string, subject: string) {
  const [{ tableCsv }, { downloadBlob }] = await Promise.all([import('@/lib/table-export'), import('@/features/journey/export/build')])
  const csv = tableCsv({ sheet: title, columns: data.columns.map((header) => ({ header })), rows: data.rows.map((r) => r.map(String)), about: [] })
  const filename = `${fileStem(subject, title, todayIso())}.csv`
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
  return filename
}

async function downloadCardPng(root: HTMLElement, data: CardData | null, title: string, subject: string) {
  const svg = chartSvg(root)
  if (!svg) throw new Error('This chart isn’t drawn as SVG.')
  const cs = getComputedStyle(root)
  const muted = cs.getPropertyValue('--muted-foreground').trim() || '#667085'
  const blob = await cardPng(svg, {
    title,
    caption: `${subject} · ${todayIso()}`,
    legend: data?.legend,
    colors: { bg: cs.backgroundColor || '#ffffff', fg: cs.color || '#101828', muted },
    font: cs.fontFamily || 'sans-serif',
  })
  const { downloadBlob } = await import('@/features/journey/export/build')
  const filename = `${fileStem(subject, title, todayIso())}.png`
  downloadBlob(blob, filename)
  return filename
}

/**
 * A chart card's "⋯" menu: Expand, Download image (PNG of the chart's SVG with a title, asset and date caption) and
 * Download data (CSV of the series the chart draws now, filters applied). What's offered is read when the menu opens:
 * a chart that isn't SVG says so instead of offering the image.
 */
export function CardMenu({
  title,
  subject,
  root,
  data,
  onExpand,
}: {
  title: string
  /** The asset the card is about: in the PNG caption and the file names. */
  subject: string
  /** The element holding the chart (the card, or the Expand dialog). */
  root: RefObject<HTMLElement | null>
  data: RefObject<CardData | null>
  onExpand?: () => void
}) {
  const [offer, setOffer] = useState({ svg: false, rows: 0 })

  const run = async (what: 'image' | 'data') => {
    try {
      const filename =
        what === 'image' ? await downloadCardPng(root.current!, data.current, title, subject) : await downloadCardCsv(data.current!, title, subject)
      toast.success(what === 'image' ? 'Image downloaded' : 'Data downloaded', { description: filename })
    } catch (e) {
      toast.error('The download failed', { description: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && setOffer({ svg: !!chartSvg(root.current), rows: data.current?.rows.length ?? 0 })}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-[26px] shrink-0 rounded-[8px] text-text-secondary" aria-label={`${title}: more actions`}>
          <Ellipsis size={15} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} collisionPadding={16} className="w-[232px] max-w-[calc(100vw-32px)] rounded-[12px] border border-border p-[6px] shadow-popover ring-0">
        {onExpand && (
          <DropdownMenuItem className={ITEM} onSelect={onExpand}>
            <Maximize2 aria-hidden="true" />
            Expand
          </DropdownMenuItem>
        )}
        {offer.svg && (
          <DropdownMenuItem className={ITEM} onSelect={() => void run('image')}>
            <FileImage aria-hidden="true" />
            Download image (PNG)
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={ITEM} disabled={!offer.rows} onSelect={() => void run('data')}>
          <Sheet aria-hidden="true" />
          {offer.rows ? 'Download data (CSV)' : 'No data to download'}
        </DropdownMenuItem>
        {!offer.svg && <p className="m-0 px-[10px] pt-[4px] pb-[6px] text-[12px] leading-[17px] text-muted-foreground">No image download: this chart isn’t drawn as SVG.</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
