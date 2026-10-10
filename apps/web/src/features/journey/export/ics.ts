import { formatDay } from '@/lib/dates'
import { CATEGORY_META } from '../constants'
import { eventIndications } from '../indications'
import { eventLink, exportDay, isoDate, summaryText, upcomingMilestones, type ExportContext } from './model'

/** RFC 5545 TEXT: backslash, semicolon, comma and newlines escaped. */
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Lines longer than 75 octets fold onto continuation lines starting with a space, never inside a UTF-8 character. */
function fold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

const compact = (d: string) => d.replace(/-/g, '')
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** The next day of `YYYY-MM-DD`, compact (an all-day event's exclusive end). */
function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return compact(t.toISOString().slice(0, 10))
}

/** The upcoming expected milestones as an iCalendar file of all-day events (partial dates sit on the period's first day). */
export function toIcs(ctx: ExportContext): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PharmaEdge//Asset journey//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${text(`${ctx.asset.name} milestones`)}`]
  for (const e of upcomingMilestones(ctx.events, exportDay(ctx.exportedAt))) {
    const raw = isoDate(e.date)
    const day = raw.length === 4 ? `${raw}-01-01` : raw.length === 7 ? `${raw}-01` : raw
    const exact = raw.length === 10
    const description = [
      exact ? '' : `Expected ${formatDay(raw)} (date not yet exact).`,
      `${CATEGORY_META[e.category]?.label ?? e.category} · ${e.significance}`,
      eventIndications(e).length ? `Indications: ${eventIndications(e).join(', ')}` : '',
      summaryText(e),
    ].filter(Boolean)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${text(`${ctx.asset.id}-${e.id}@pharmaedge`)}`,
      `DTSTAMP:${stamp(ctx.exportedAt)}`,
      `DTSTART;VALUE=DATE:${compact(day)}`,
      `DTEND;VALUE=DATE:${nextDay(day)}`,
      `SUMMARY:${text(`${ctx.asset.name}: ${e.title}`)}`,
      `DESCRIPTION:${text(description.join('\n'))}`,
      `URL:${eventLink(ctx, e)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}
