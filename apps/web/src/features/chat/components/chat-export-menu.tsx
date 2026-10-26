import { ChevronDown, Download, FileCode2, FileText, LoaderCircle, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { BTN_SM } from '@/features/journey/controls'
import { useChatMessages, useChatSessions, type ChatMessage } from '../api'
import { conversationMarkdown, qaPairs, transcriptFileName } from '../transcript'
import { useTurn } from '../turn-store'

type Format = 'md' | 'pdf'

const FORMATS: { format: Format; label: string; hint: string; icon: LucideIcon }[] = [
  { format: 'md', label: 'Markdown', hint: '.md · sources as numbered footnotes with links', icon: FileCode2 },
  { format: 'pdf', label: 'PDF', hint: '.pdf · printable, sources and page numbers', icon: FileText },
]

const ITEM = 'items-start gap-[10px] rounded-[8px] px-[10px] py-[7px] [&_svg]:mt-[2px]'

/** Builds and downloads the file; returns its name. The download helper and jsPDF load on first use. */
async function exportConversation(format: Format, title: string, messages: ChatMessage[]): Promise<string> {
  const exportedAt = new Date()
  const filename = transcriptFileName(title, exportedAt, format)
  const [{ downloadBlob }, blob] = await Promise.all([
    import('@/features/journey/export/build'),
    format === 'md'
      ? new Blob([conversationMarkdown(title, messages, exportedAt, window.location.origin)], { type: 'text/markdown;charset=utf-8' })
      : import('../export-pdf').then((m) => m.buildConversationPdf(title, messages, exportedAt, window.location.origin)),
  ])
  downloadBlob(blob, filename)
  return filename
}

/** The chat header's "Export" menu: the whole conversation as Markdown or PDF (jsPDF loads on the first PDF). */
export function ChatExportMenu({ sessionId }: { sessionId: string }) {
  const turn = useTurn(sessionId)
  // Paused during a turn, as in the conversation (the stream owns the list until it settles).
  const messages = useChatMessages(sessionId, !turn)
  const session = useChatSessions().data?.find((s) => s.id === sessionId)
  const streaming = turn?.status === 'streaming'
  const [busy, setBusy] = useState(false)
  const list = messages.data ?? []
  const questions = qaPairs(list).length
  const title = session?.title || 'Asset AI chat'

  const run = async (format: Format) => {
    setBusy(true)
    try {
      const filename = await exportConversation(format, title, list)
      toast.success('Conversation exported', { description: filename })
    } catch (e) {
      toast.error('The export failed', { description: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy || streaming || questions === 0}>
        <Button variant="outline" size="sm" className={BTN_SM}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          <span className="max-[480px]:sr-only">{busy ? 'Exporting…' : 'Export'}</span>
          <ChevronDown className="-mr-[2px] size-[13px] text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} collisionPadding={16} className="w-[288px] max-w-[calc(100vw-32px)] rounded-[12px] border border-border p-[6px] shadow-popover ring-0">
        <DropdownMenuLabel className="flex flex-col gap-[2px] px-[10px] pt-[6px] pb-[8px] text-[13px] text-foreground">
          <b className="font-semibold">Export this conversation</b>
          <span className="truncate text-[12px] leading-[17px] font-normal text-muted-foreground">
            {title} · {questions} question{questions === 1 ? '' : 's'}
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
