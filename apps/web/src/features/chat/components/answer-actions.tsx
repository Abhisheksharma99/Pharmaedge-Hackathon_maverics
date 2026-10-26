import { BookmarkPlus, Check, Copy, Pilcrow, ThumbsDown, ThumbsUp, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAnswerFeedback, type ChatFeedback, type ChatMessage } from '../api'
import { answerMarkdown, answerPlainText } from '../transcript'
import { SaveNoteDialog } from './save-note-dialog'

const DOWN_REASONS = ['Inaccurate', 'Missing information', 'Wrong sources', 'Not relevant']
const REASON_MAX = 280

function ActionButton({ icon: Icon, label, onClick, pressed, className }: { icon: LucideIcon; label: string; onClick: () => void; pressed?: boolean; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn('text-muted-foreground hover:text-foreground [&_svg]:size-[15px]', className)}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** The answer's tools under it: copy (Markdown / plain text), save to the journey as a team note, and thumbs up / down. */
export function AnswerActions({ message, question, sessionId }: { message: ChatMessage; question: string | null; sessionId: string }) {
  const feedback = useAnswerFeedback(sessionId)
  const [copied, setCopied] = useState<'md' | 'text' | null>(null)
  const [saving, setSaving] = useState(false)
  // The thumb just clicked: its optional reason form is open.
  const [asking, setAsking] = useState<ChatFeedback['rating'] | null>(null)
  const [reason, setReason] = useState('')
  const rating = message.feedback?.rating ?? null

  const copy = async (kind: 'md' | 'text') => {
    const origin = window.location.origin
    try {
      await navigator.clipboard.writeText(kind === 'md' ? answerMarkdown(message, origin) : answerPlainText(message, origin))
      setCopied(kind)
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1600)
      toast.success(kind === 'md' ? 'Answer copied as Markdown' : 'Answer copied as plain text')
    } catch {
      toast.error('Couldn’t copy to the clipboard.')
    }
  }

  const rate = (next: ChatFeedback['rating']) => {
    setReason('')
    setAsking(next)
    if (next === rating) return
    feedback.mutate({ turnId: message.id, rating: next }, { onError: () => toast.error('Your feedback couldn’t be saved. Try again.') })
  }

  const sendReason = () => {
    const text = reason.trim().slice(0, REASON_MAX)
    if (!asking) return
    setAsking(null)
    if (!text) return
    feedback.mutate(
      { turnId: message.id, rating: asking, reason: text },
      { onSuccess: () => toast.success('Thanks for the feedback'), onError: () => toast.error('Your feedback couldn’t be saved. Try again.') },
    )
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <div role="toolbar" aria-label="Answer actions" className="-ml-[6px] flex flex-wrap items-center gap-[2px]">
        <ActionButton icon={copied === 'md' ? Check : Copy} label="Copy (Markdown with sources)" onClick={() => void copy('md')} />
        <ActionButton icon={copied === 'text' ? Check : Pilcrow} label="Copy as plain text" onClick={() => void copy('text')} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSaving(true)}
          className="h-[28px] gap-[6px] px-[8px] text-[12.5px] text-muted-foreground hover:text-foreground [&_svg]:size-[15px]"
        >
          <BookmarkPlus aria-hidden="true" /> Save to journey
        </Button>
        <span aria-hidden="true" className="mx-[4px] h-[16px] w-px bg-border" />
        <ActionButton
          icon={ThumbsUp}
          label={rating === 'up' ? 'You rated this helpful' : 'Helpful'}
          pressed={rating === 'up'}
          onClick={() => rate('up')}
          className={cn(rating === 'up' && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary [&_svg]:fill-current')}
        />
        <ActionButton
          icon={ThumbsDown}
          label={rating === 'down' ? 'You rated this not helpful' : 'Not helpful'}
          pressed={rating === 'down'}
          onClick={() => rate('down')}
          className={cn(rating === 'down' && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary [&_svg]:fill-current')}
        />
        {message.feedback?.reason && !asking && (
          <span className="ml-[4px] max-w-[260px] truncate text-[12px] text-muted-foreground" title={message.feedback.reason}>
            “{message.feedback.reason}”
          </span>
        )}
      </div>
      {asking && (
        <form
          aria-label="Feedback reason"
          onSubmit={(e) => {
            e.preventDefault()
            sendReason()
          }}
          className="flex max-w-[560px] flex-col gap-[8px] rounded-[10px] border bg-card p-[10px]"
        >
          <label htmlFor={`reason-${message.id}`} className="text-[12.5px] font-medium text-secondary-foreground">
            {asking === 'up' ? 'What was helpful?' : 'What went wrong?'} <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          {asking === 'down' && (
            <div className="flex flex-wrap gap-[6px]">
              {DOWN_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn(
                    'rounded-full border px-[9px] py-[3px] text-[12px] text-secondary-foreground hover:border-primary hover:text-primary',
                    reason === r && 'border-primary bg-primary-soft text-primary',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-[6px] max-[480px]:flex-col">
            <input
              id={`reason-${message.id}`}
              autoFocus
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setAsking(null)}
              placeholder="A few words help us improve Asset AI"
              className="h-[32px] min-w-0 flex-1 rounded-[8px] border bg-background px-[10px] text-[13px] outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/12"
            />
            <div className="flex gap-[6px]">
              <Button type="submit" size="sm" disabled={!reason.trim()}>
                Send
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(null)}>
                Skip
              </Button>
            </div>
          </div>
        </form>
      )}
      {saving && <SaveNoteDialog question={question} message={message} onClose={() => setSaving(false)} />}
    </div>
  )
}
