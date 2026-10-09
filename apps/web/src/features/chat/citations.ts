/** "[1]", "[1][3]" (two markers) and "[1, 3]". */
const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g

/** "a [1, 3] b" → ["a ", 1, 3, " b"]: strings are text, numbers are citation markers. */
export function splitCitations(text: string): (string | number)[] {
  const parts: (string | number)[] = []
  let last = 0
  for (const match of text.matchAll(MARKER)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(...match[1]!.split(',').map(Number))
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/** Link target the markdown renderer turns into a citation chip. */
export const CITE_HREF_PREFIX = '#cite-'

/** The subset of mdast this plugin touches. */
interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
}

function withCitations(node: MdNode): void {
  if (!node.children || node.type === 'link') return
  node.children = node.children.flatMap((child): MdNode[] => {
    if (child.type !== 'text' || !child.value) {
      withCitations(child)
      return [child]
    }
    return splitCitations(child.value).map((part) =>
      typeof part === 'string'
        ? { type: 'text', value: part }
        : { type: 'link', url: `${CITE_HREF_PREFIX}${part}`, children: [{ type: 'text', value: String(part) }] },
    )
  })
}

/** Remark plugin: citation markers in text become `#cite-n` links (code is left alone). */
export function remarkCitations() {
  return (tree: MdNode) => withCitations(tree)
}
