import type { RecordTab, SourceRecord } from '../api'
import { recordTitle, recordUrl } from './record-text'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])

/** APA's date: "(2024, March 5)", "(2024, March)", "(2024)", or "(n.d.)" for a record without one. */
export function apaDate(iso: string): string {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(iso)
  if (!m) return '(n.d.)'
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : undefined
  if (!month) return `(${m[1]})`
  return m[3] ? `(${m[1]}, ${month} ${Number(m[3])})` : `(${m[1]}, ${month})`
}

const host = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

/** Who published the record, per tab: the registry, the agency, the journal, the congress, the company, the assignee. */
function source(r: SourceRecord, tab: RecordTab, company: string | undefined, url: string | undefined): string {
  const type = str(r.record_type)
  switch (tab) {
    case 'clinical':
      return ['ClinicalTrials.gov', str(r.nct_id)].filter(Boolean).join(', ')
    case 'regulatory':
      if (type.startsWith('fda')) return 'U.S. Food and Drug Administration'
      if (type.startsWith('ema')) return 'European Medicines Agency'
      return company || host(url)
    case 'publications':
      return [str(r.journal) || 'PubMed', str(r.pmid) && `PMID ${str(r.pmid)}`].filter(Boolean).join(', ')
    case 'conferences':
      return [str(r.conference), str(r.year) || str(r.date).slice(0, 4)].filter(Boolean).join(' ') || host(url)
    case 'patents':
      return [strs(r.assignees).join(', '), str(r.publication_number) && `Patent ${str(r.publication_number)}`].filter(Boolean).join(', ')
    case 'news':
      return str(r.company) || host(url)
    default:
      return company || host(url)
  }
}

/** The record's link: its own, else the registry page its id gives. */
function link(r: SourceRecord, tab: RecordTab): string | undefined {
  const own = recordUrl(r)
  if (own) return own
  if (tab === 'clinical' && str(r.nct_id)) return `https://clinicaltrials.gov/study/${str(r.nct_id)}`
  if (tab === 'publications' && str(r.pmid)) return `https://pubmed.ncbi.nlm.nih.gov/${str(r.pmid)}/`
  return undefined
}

/**
 * An APA-style one-line citation of a record: "Title. (2024, March 5). Source. URL" (no authors: records don't carry them).
 * `company` is the asset's company, the publisher of its documents and IR releases.
 */
export function recordCitation(r: SourceRecord, tab: RecordTab, company?: string): string {
  const acronym = tab === 'clinical' ? str(r.acronym) : ''
  const title = (acronym ? `${acronym}: ${recordTitle(r)}` : recordTitle(r)).replace(/[.\s]+$/, '')
  const date = str(tab === 'patents' ? r.grant_date || r.date : tab === 'clinical' ? r.date || r.start_date : r.date)
  const url = link(r, tab)
  const src = source(r, tab, company, url)
  return [`${title}.`, `${apaDate(date)}.`, src && `${src.replace(/\.$/, '')}.`, url].filter(Boolean).join(' ')
}
