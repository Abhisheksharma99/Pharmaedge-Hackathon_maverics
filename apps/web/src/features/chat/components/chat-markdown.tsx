import { createContext, use, useMemo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { Citation } from '../api'
import { CITE_HREF_PREFIX, remarkCitations } from '../citations'
import { CitationChip } from './citation-chip'

interface CitationLookup {
  byNumber: Map<number, Citation>
  onOpen: (c: Citation) => void
}

const CitationContext = createContext<CitationLookup>({ byNumber: new Map(), onOpen: () => {} })

function Anchor({ href, children }: { href?: string; children?: React.ReactNode }) {
  const { byNumber, onOpen } = use(CitationContext)
  if (href?.startsWith(CITE_HREF_PREFIX)) {
    const n = Number(href.slice(CITE_HREF_PREFIX.length))
    return <CitationChip n={n} citation={byNumber.get(n)} onOpen={onOpen} />
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
      {children}
    </a>
  )
}

// Defined once so streaming re-renders don't remount the rendered tree.
const COMPONENTS: Components = {
  a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
  ul: ({ children }) => <ul className="list-disc space-y-[4px] pl-[20px]">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-[4px] pl-[20px]">{children}</ol>,
  h1: ({ children }) => <h3 className="text-[15px] font-semibold text-foreground">{children}</h3>,
  h2: ({ children }) => <h3 className="text-[15px] font-semibold text-foreground">{children}</h3>,
  h3: ({ children }) => <h4 className="font-semibold text-foreground">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-muted px-[4px] font-mono text-[12px]">{children}</code>,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-[12px] border">
      <table className="w-full border-collapse text-[12.5px] leading-[1.4] [&_td:first-child]:font-medium [&_td:first-child]:text-text-secondary">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-background">{children}</thead>,
  th: ({ children }) => <th className="px-[10px] py-[8px] text-left font-semibold text-foreground">{children}</th>,
  td: ({ children }) => <td className="border-t border-hair px-[10px] py-[8px] align-top text-foreground">{children}</td>,
}

const REMARK_PLUGINS = [remarkGfm, remarkCitations]

/** Caret after the last block while the answer is still streaming in. */
const CARET =
  "[&>:last-child]:after:ml-[2px] [&>:last-child]:after:inline-block [&>:last-child]:after:h-[1em] [&>:last-child]:after:w-[3px] [&>:last-child]:after:translate-y-[2px] [&>:last-child]:after:animate-pulse [&>:last-child]:after:rounded-sm [&>:last-child]:after:bg-primary [&>:last-child]:after:content-['']"

/** An answer's markdown: GFM tables and lists, "[n]" citation markers as clickable chips. */
export function ChatMarkdown({
  content,
  citations,
  onCite,
  streaming,
}: {
  content: string
  citations: Citation[]
  onCite: (c: Citation) => void
  streaming?: boolean
}) {
  const lookup = useMemo(() => ({ byNumber: new Map(citations.map((c) => [c.n, c])), onOpen: onCite }), [citations, onCite])
  return (
    <CitationContext value={lookup}>
      <div className={cn('flex flex-col gap-[10px] text-[13.5px] leading-[1.6] text-pretty text-secondary-foreground', streaming && CARET)}>
        <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
          {content}
        </Markdown>
      </div>
    </CitationContext>
  )
}
