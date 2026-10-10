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
  /** Facets of the records panel (distribution bar + selects), in display order; the first one drives the bar. */
  facets?: FacetDef[];
  /** Trials: the field the "company-sponsored only" toggle matches against the asset's company name. */
  sponsorField?: string;
}

/** One facet of a tab: `expr` is a Mongo expression yielding one value per record (a field, or a derived value; list fields use their first element, as the column shows it), so segments never exceed the row count. */
export interface FacetDef {
  key: string;
  label: string;
  expr: unknown;
}

const firstOf = (...fields: string[]): unknown =>
  fields.reduceRight<unknown>((rest, f) => (rest === null ? `$${f}` : { $ifNull: [`$${f}`, rest] }), null);

export const SOURCE_TABS: Record<string, SourceTab> = {
  clinical: {
    collections: ['trial_records'],
    searchFields: ['title', 'official_title', 'acronym', 'nct_id', 'lead_sponsor'],
    omitInList: ['study'],
    keyField: 'record_key',
    insightFacets: ['phases', 'overall_status', 'conditions'],
    facets: [
      { key: 'phases', label: 'Phase', expr: { $arrayElemAt: [{ $ifNull: ['$phases', []] }, 0] } },
      { key: 'overall_status', label: 'Status', expr: '$overall_status' },
      { key: 'conditions', label: 'Indication', expr: { $arrayElemAt: [{ $ifNull: ['$conditions', []] }, 0] } },
    ],
    sponsorField: 'lead_sponsor',
  },
  regulatory: {
    collections: ['fda_records', 'ema_records'],
    // Monthly adverse-event counts are a chart (see series), not list items.
    match: { record_type: { $ne: 'fda_adverse_events_monthly' } },
    searchFields: ['name_of_medicine', 'brand_names', 'application_number', 'submission_class', 'record_type', 'title'],
    omitInList: ['documents', 'products', 'therapeutic_indication', 'content', 'evidence'],
    keyField: 'record_key',
    insightFacets: ['record_type', 'submission_status'],
    facets: [
      { key: 'region', label: 'Region', expr: { $cond: [{ $regexMatch: { input: { $ifNull: ['$record_type', ''] }, regex: '^fda' } }, 'US', 'EU'] } },
      { key: 'record_type', label: 'Record type', expr: '$record_type' },
      { key: 'status', label: 'Status', expr: firstOf('submission_status', 'medicine_status', 'status', 'post_authorisation_opinion_status') },
    ],
  },
  documents: {
    collections: ['company_records'],
    match: { record_type: { $in: ['prescribing_info', 'annual_report', 'company_document', 'company_page'] } },
    searchFields: ['title', 'url'],
    omitInList: ['content'],
    keyField: 'record_key',
    insightFacets: ['record_type'],
    facets: [{ key: 'record_type', label: 'Type', expr: '$record_type' }],
  },
  'company-ir': {
    collections: ['company_records'],
    // Press releases and investor-presentation slides (crawler step `presentations`): both are investor relations.
    match: { record_type: { $in: ['press_release', 'presentation_slide'] } },
    searchFields: ['title', 'deck_title'],
    omitInList: ['content', 'slide_text', 'claims', 'metrics', 'evidence'],
    keyField: 'record_key',
    insightFacets: ['mentions'],
    facets: [{ key: 'category', label: 'Category', expr: { $arrayElemAt: [{ $ifNull: ['$tags', []] }, 0] } }],
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
    facets: [
      { key: 'design', label: 'Design', expr: { $arrayElemAt: [{ $ifNull: ['$publication_types', []] }, 0] } },
      { key: 'journal', label: 'Journal', expr: '$journal' },
    ],
  },
  // Team conference crawler (ERS, ATS, CHEST abstracts).
  conferences: {
    collections: ['conference_records'],
    searchFields: ['title', 'conference', 'session_title', 'category', 'authors'],
    omitInList: ['abstract'],
    keyField: 'record_key',
    insightFacets: ['conference', 'session_type'],
    facets: [
      {
        key: 'conference',
        label: 'Congress',
        // "CHEST 2025", as the column shows it.
        expr: { $trim: { input: { $concat: [{ $ifNull: ['$conference', ''] }, ' ', { $toString: { $ifNull: ['$year', { $substrCP: [{ $ifNull: ['$date', ''] }, 0, 4] }] } }] } } },
      },
      { key: 'session_type', label: 'Format', expr: '$session_type' },
    ],
  },
  // Team patent crawler (AdisInsight, PubChem, Google Patents).
  patents: {
    collections: ['patent_records'],
    searchFields: ['title', 'publication_number', 'assignees', 'family_id'],
    omitInList: ['abstract', 'events', 'cpc', 'inventors'],
    keyField: 'record_key',
    insightFacets: ['legal_status', 'assignees'],
    facets: [
      { key: 'legal_status', label: 'Status', expr: '$legal_status' },
      { key: 'assignees', label: 'Assignee', expr: { $arrayElemAt: [{ $ifNull: ['$assignees', []] }, 0] } },
    ],
    statusField: 'legal_status',
  },
};

/** Every record collection some tab reads; the only valid sources of a note. */
export const RECORD_COLLECTIONS = [...new Set(Object.values(SOURCE_TABS).flatMap((t) => t.collections))];

/** Mongo exclusion projection of what a list response leaves out for a tab (heavy fields and `_id`). */
export const listOmit = (tab: SourceTab): Record<string, 0> => Object.fromEntries([...tab.omitInList, '_id'].map((f) => [f, 0]));
