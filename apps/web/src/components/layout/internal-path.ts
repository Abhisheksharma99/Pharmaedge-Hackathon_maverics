/**
 * Notification links come from the crawler and the API. Resolve them like the browser would and
 * follow only the ones that stay on the app's origin (this catches `//host`, `/\host`, `/<tab>/host`);
 * returns the normalised path, or null.
 */
export function internalPath(link: string, origin: string = window.location.origin): string | null {
  if (!link.startsWith('/')) return null
  try {
    const url = new URL(link, origin)
    return url.origin === origin ? url.pathname + url.search + url.hash : null
  } catch {
    return null
  }
}
