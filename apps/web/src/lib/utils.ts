export { cn } from "cn"

/** A URL from crawled data, only if it is a web link: `javascript:`, `data:` and the like never reach href or window.open. */
export const safeUrl = (url: unknown): string | undefined =>
  typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined
