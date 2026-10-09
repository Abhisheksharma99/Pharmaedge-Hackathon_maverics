import type { Citation } from './chat.types.js';

/** Asset-page tab and human label for each record collection (mirrors the web's TAB_FOR_COLLECTION). */
export const COLLECTION_META: Record<string, { tab: string; label: string }> = {
  fda_records: { tab: 'regulatory', label: 'FDA' },
  ema_records: { tab: 'regulatory', label: 'EMA' },
  trial_records: { tab: 'clinical', label: 'ClinicalTrials.gov' },
  company_records: { tab: 'company-ir', label: 'Company' },
  articles: { tab: 'news', label: 'News' },
  publication_records: { tab: 'publications', label: 'PubMed' },
  conference_records: { tab: 'conferences', label: 'Conference abstract' },
  patent_records: { tab: 'patents', label: 'Patent' },
};

/** Company documents (prescribing information, annual reports) live on the Documents tab, not Company IR. */
const DOCUMENT_TYPES = new Set(['prescribing_info', 'annual_report', 'company_document', 'company_page']);

export type CitationSource = Omit<Citation, 'n' | 'tab' | 'source'> & { recordType?: string | null };

/**
 * Numbers every record or event handed to the model during one turn. The model
 * cites them as [n]; the answer keeps only the citations it actually used.
 */
export class CitationRegistry {
  private readonly byKey = new Map<string, Citation>();

  /** The ref number for a source record, or null when it can't be opened in the app. */
  ref(src: CitationSource): number | null {
    const meta = COLLECTION_META[src.collection];
    if (!meta || !src.recordKey) return null;
    const key = `${src.assetId}|${src.collection}|${src.recordKey}`;
    let c = this.byKey.get(key);
    if (!c) {
      const tab = src.collection === 'company_records' && src.recordType && DOCUMENT_TYPES.has(src.recordType) ? 'documents' : meta.tab;
      const { recordType: _, ...rest } = src;
      c = { ...rest, n: this.byKey.size + 1, tab, source: meta.label };
      this.byKey.set(key, c);
    }
    return c.n;
  }

  /**
   * The answer with its citations renumbered 1..k in reading order, and those citations. Markers may be [n],
   * [n][m] or [n, m]; refs the model made up are dropped from the text.
   */
  finalize(text: string): { text: string; citations: Citation[] } {
    const known = new Map([...this.byKey.values()].map((c) => [c.n, c]));
    const renumber = new Map<number, number>();
    const out = text.replace(/\s?\[(\d+(?:\s*,\s*\d+)*)\]/g, (marker, list: string) => {
      const ns = list.split(',').map((n) => Number(n.trim())).filter((n) => known.has(n));
      if (!ns.length) return '';
      for (const n of ns) if (!renumber.has(n)) renumber.set(n, renumber.size + 1);
      return `${/^\s/.test(marker) ? marker[0] : ''}[${ns.map((n) => renumber.get(n)).join(', ')}]`;
    });
    const citations = [...renumber].map(([old, n]) => ({ ...known.get(old)!, n }));
    return { text: out, citations };
  }
}
