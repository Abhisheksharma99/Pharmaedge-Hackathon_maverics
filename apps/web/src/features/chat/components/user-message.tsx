/** The user's question, right-aligned. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="max-w-[70%] self-end rounded-[14px_14px_4px_14px] bg-primary px-[14px] py-[9px] whitespace-pre-wrap text-primary-foreground">
      {text}
    </div>
  )
}
