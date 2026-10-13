/**
 * Only same-app paths are allowed after login ("/assets?x=1"), never
 * "//evil.com" or "https://…", so returnTo can't be used as an open redirect.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}
