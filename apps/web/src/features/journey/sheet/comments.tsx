import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BTN_SM } from '../controls'
import { useAddComment, useAnnotations } from '../annotations-api'
import { SheetSection } from './sheet-section'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** Team comments on an event; Enter sends, Shift+Enter breaks the line (README §6.4, §9). */
export function Comments({ assetId, eventId }: { assetId: string; eventId: string }) {
  const annotations = useAnnotations(assetId)
  const comments = annotations.data?.comments[eventId] ?? []
  const add = useAddComment(assetId)
  const [text, setText] = useState('')
  const send = () => {
    const t = text.trim()
    if (!t) return
    setText('')
    add.mutate({ eventId, text: t }, { onError: () => setText((cur) => cur || t) })
  }
  return (
    <SheetSection title="Comments" extra={comments.length > 0 && <> · {comments.length}</>}>
      {annotations.isPending && <Skeleton role="status" aria-label="Loading comments" className="h-[40px] w-full" />}
      {annotations.isError && (
        <p role="alert" className="flex flex-wrap items-center gap-[8px] text-muted-foreground">
          Comments couldn’t be loaded.
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void annotations.refetch()}>
            Try again
          </Button>
        </p>
      )}
      <ul>
        {comments.map((c) => (
          <li key={c.id} className="flex gap-[10px] border-b border-hair py-[8px]">
            <span aria-hidden="true" className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">
              {initials(c.by.name)}
            </span>
            <div className="min-w-0">
              <b className="font-semibold">{c.by.name}</b>
              <span className="text-muted-foreground"> · {day(c.at)}</span>
              <p className="mt-[2px] whitespace-pre-wrap text-secondary-foreground">{c.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-[10px] flex items-end gap-[8px]">
        <textarea
          rows={2}
          maxLength={2000}
          value={text}
          aria-label="Add a comment"
          placeholder="Add a comment for your team…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className="min-h-[52px] flex-1 resize-y rounded-lg border px-[10px] py-[8px] outline-none focus:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
        />
        <Button size="sm" className={BTN_SM} disabled={!text.trim()} onClick={send}>
          Comment
        </Button>
      </div>
    </SheetSection>
  )
}
