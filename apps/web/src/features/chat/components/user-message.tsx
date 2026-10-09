/** The user's question, right-aligned. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="max-w-[88%] self-end rounded-[14px_14px_4px_14px] bg-[#eef2fd] px-3.5 py-2.5 text-[13.5px] font-medium whitespace-pre-wrap text-foreground">
      {text}
    </div>
  )
}
