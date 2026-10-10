import { Send, Square } from 'lucide-react'
import { useId, type Ref } from 'react'
import { Button } from '@/components/ui/button'

/** Question box: Enter sends, Shift+Enter adds a line; Stop replaces Send while an answer streams. */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  placeholder = 'Ask a follow-up question…',
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
  placeholder?: string
  inputRef?: Ref<HTMLTextAreaElement>
}) {
  const id = useId()
  const text = value.trim()
  const submit = () => {
    if (text && !streaming) onSend(text)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex items-end gap-2 rounded-xl border border-input bg-card py-1.5 pr-1.5 pl-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20"
    >
      <label htmlFor={id} className="sr-only">
        Ask Asset AI
      </label>
      <textarea
        id={id}
        ref={inputRef}
        rows={1}
        aria-label="Message Asset AI"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[14px] leading-5 outline-none field-sizing-content placeholder:text-muted-foreground"
      />
      {streaming ? (
        <Button type="button" variant="outline" size="icon-lg" aria-label="Stop answering" onClick={onStop} className="size-10 rounded-[10px]">
          <Square className="fill-current" />
        </Button>
      ) : (
        <Button type="submit" size="icon-lg" aria-label="Send" disabled={!text} className="size-10 rounded-[10px]">
          <Send />
        </Button>
      )}
    </form>
  )
}
