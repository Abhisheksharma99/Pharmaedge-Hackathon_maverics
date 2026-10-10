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
      className="flex items-end gap-[8px] rounded-[14px] border bg-card py-[8px] pr-[8px] pl-[14px] shadow-[0_4px_14px_rgba(16,24,40,0.06)] focus-within:border-primary"
    >
      <label htmlFor={id} className="sr-only">
        Ask Asset AI
      </label>
      <textarea
        id={id}
        ref={inputRef}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        className="max-h-[140px] flex-1 resize-none bg-transparent py-[6px] text-[13.5px] leading-[1.5] outline-none field-sizing-content placeholder:text-muted-foreground"
      />
      {streaming ? (
        <Button type="button" variant="outline" size="sm" aria-label="Stop answering" onClick={onStop} className="w-[34px] px-0">
          <Square className="fill-current" />
        </Button>
      ) : (
        <Button type="submit" size="sm" aria-label="Send" disabled={!text} className="w-[34px] px-0">
          <Send />
        </Button>
      )}
    </form>
  )
}
