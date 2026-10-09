import type { Document } from 'mongodb';

/**
 * Asset-page tabs and the record collections behind them (spec §3.2).
 *
 * A crawler built elsewhere becomes visible in the app by writing records in
 * the shared contract (record_key, record_type, source, date, assets, ...) and
 * adding an entry here.
 */
export interface SourceTab {
  /** Collections read for this tab; several are merged and sorted by date. */
  collections: string[];
  /** Extra match applied to every query of the tab. */
  match?: Document;
  /** Fields matched by the free-text `q` filter. */
  searchFields: string[];
  /** Heavy fields left out of list responses (fetched by the record endpoint). */
  omitInList: string[];
  /** Field the records are keyed by (`record_key` for everything but articles). */
  keyField: string;
  /** Field the `status` filter applies to (default `overall_status`, the trial status). */
  statusField?: string;
  /** Fields whose top values the tab insights count. */
  insightFacets: string[];
}

export const SOURCE_TABS: Record<string, SourceTab> = {
  clinical: {
    collections: ['trial_records'],
    searchFields: ['title', 'official_title', 'acronym', 'nct_id', 'lead_sponsor'],
    omitInList: ['study'],
    keyField: 'record_key',
    insightFacets: ['phases', 'overall_status', 'conditions'],
  },
  regulatory: {
    collections: ['fda_records', 'ema_records'],
    // Monthly adverse-event counts are a chart (see series), not list items.
    match: { record_type: { $ne: 'fda_adverse_events_monthly' } },
    searchFields: ['name_of_medicine', 'brand_names', 'application_number', 'submission_class', 'record_type', 'title'],
    omitInList: ['documents', 'products', 'therapeutic_indication', 'content', 'evidence'],
    keyField: 'record_key',
    insightFacets: ['record_type', 'submission_status'],
  },
  documents: {
    collections: ['company_records'],
    match: { record_type: { $in: ['prescribing_info', 'annual_report', 'company_document', 'company_page'] } },
    searchFields: ['title', 'url'],
    omitInList: ['content'],
    keyField: 'record_key',
    insightFacets: ['record_type'],
  },
  'company-ir': {
    collections: ['company_records'],
    match: { record_type: 'press_release' },
    searchFields: ['title'],
    omitInList: ['content'],
    keyField: 'record_key',
    insightFacets: ['mentions'],
  },
  news: {
    collections: ['articles'],
    searchFields: ['title', 'company', 'keyword'],
    omitInList: ['content', 'feed_description'],
    keyField: 'url',
    insightFacets: ['source'],
  },
  publications: {
    collections: ['publication_records'],
    searchFields: ['title', 'journal', 'authors'],
    omitInList: ['abstract'],
    keyField: 'record_key',
    insightFacets: ['journal', 'publication_types'],
  },
  // Team conference crawler (ERS, ATS, CHEST abstracts).
  conferences: {
    collections: ['conference_records'],
    searchFields: ['title', 'conference', 'session_title', 'category', 'authors'],
    omitInList: ['abstract'],
    keyField: 'record_key',
    insightFacets: ['conference', 'session_type'],
  },
  // Team patent crawler (AdisInsight, PubChem, Google Patents).
  patents: {
    collections: ['patent_records'],
    searchFields: ['title', 'publication_number', 'assignees', 'family_id'],
    omitInList: ['abstract', 'events', 'cpc', 'inventors'],
    keyField: 'record_key',
    insightFacets: ['legal_status', 'assignees'],
    statusField: 'legal_status',
  },
};

/** Every record collection some tab reads; the only valid sources of a note. */
export const RECORD_COLLECTIONS = [...new Set(Object.values(SOURCE_TABS).flatMap((t) => t.collections))];

/** Mongo exclusion projection of what a list response leaves out for a tab (heavy fields and `_id`). */
export const listOmit = (tab: SourceTab): Record<string, 0> => Object.fromEntries([...tab.omitInList, '_id'].map((f) => [f, 0]));
