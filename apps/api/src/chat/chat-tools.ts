import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Db, Document } from 'mongodb';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { AssetsService, type AssetDoc } from '../assets/assets.service.js';
import { CompetitorsService } from '../assets/competitors.service.js';
import { MONGO_DB } from '../database/database.module.js';
import { CrawlerClient } from '../jobs/crawler.client.js';
import { LlmService } from '../llm/llm.service.js';
import type { Card } from './chat.types.js';
import type { CitationRegistry } from './citations.js';

/**
 * Asset AI's tools (spec §6). Every record or event handed to the model gets a
 * ref number from the turn's CitationRegistry, so answers can cite it as [n].
 * Some results also render as cards (identity, job, comparison, timeline).
 */

export interface ToolContext {
  registry: CitationRegistry;
  /** Asset the chat is about (asset-page panel), if any. */
  assetId: string | null;
}

export interface ToolOutput {
  /** JSON for the model. */
  result: unknown;
  /** Short status for the UI ("8 passages"). */
  summary: string;
  cards?: Card[];
}

const ACTIVE_TRIAL_STATUSES = ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION'];
const TRIAL_STATUS: Record<string, string[]> = {
  active: ACTIVE_TRIAL_STATUSES,
  completed: ['COMPLETED'],
  stopped: ['TERMINATED', 'WITHDRAWN', 'SUSPENDED'],
};
const EVIDENCE_COLLECTIONS = ['articles', 'company_records', 'publication_records', 'conference_records'];
const ISO_DATE = { type: 'string', description: 'YYYY-MM-DD' } as const;
const today = () => new Date().toISOString().slice(0, 10);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (s: unknown, n: number) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…` : s) : undefined);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ChatCompletionTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

const ASSET_ID = { type: 'string', description: 'Asset id, a lowercase slug such as "treprostinil"' };

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  fn('search_assets', 'List tracked assets (drugs) with company, indications, mechanism and whether they are primary or competitor assets.', {
    query: { type: 'string', description: 'Optional filter on name, brand, company or indication' },
  }),
  fn('get_asset_overview', 'Identity, key metrics (approvals, active trials, upcoming milestones, record counts), competitors and latest high-significance events of one asset.', {
    asset_id: ASSET_ID,
  }, ['asset_id']),
  fn('get_timeline', 'Journey events of one asset (regulatory, clinical, safety, company, ip/patents), newest first. Includes upcoming milestones unless filtered.', {
    asset_id: ASSET_ID,
    category: { type: 'array', items: { type: 'string', enum: ['regulatory', 'clinical', 'safety', 'company', 'ip'] } },
    significance: { type: 'array', items: { type: 'string', enum: ['High', 'Medium', 'Low'] } },
    from: ISO_DATE,
    to: ISO_DATE,
    query: { type: 'string', description: 'Optional words to match in event titles and summaries' },
    limit: { type: 'integer', minimum: 1, maximum: 40 },
  }, ['asset_id']),
  fn('get_trials', 'Clinical trials (ClinicalTrials.gov) of one asset: phase, status, sponsor, dates, enrollment, conditions.', {
    asset_id: ASSET_ID,
    status: { type: 'string', enum: ['active', 'completed', 'stopped', 'all'] },
    phase: { type: 'string', enum: ['PHASE1', 'PHASE2', 'PHASE3', 'PHASE4'] },
    query: { type: 'string', description: 'Optional words to match in title, acronym, NCT id, sponsor or condition' },
    limit: { type: 'integer', minimum: 1, maximum: 30 },
  }, ['asset_id']),
  fn('get_regulatory', 'Regulatory history of one asset from FDA and EMA: approvals, label expansions, new formulations, generic approvals, orphan designations, safety communications, recalls.', {
    asset_id: ASSET_ID,
    agency: { type: 'string', enum: ['FDA', 'EMA'] },
  }, ['asset_id']),
  fn('get_patents', 'Patent estate of one asset: counts by legal status and country, and the in-force US patents in order of expiry (the exclusivity horizon).', {
    asset_id: ASSET_ID,
    query: { type: 'string', description: 'Optional words to match in patent titles (e.g. "dry powder", "prodrug")' },
  }, ['asset_id']),
  fn('get_milestones', 'Upcoming milestones (expected trial readouts, regulatory decisions, patent expiries) for assets, soonest first. Defaults to the asset in view and its competitors.', {
    asset_ids: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    months_ahead: { type: 'integer', minimum: 1, maximum: 120 },
  }),
  fn('get_competitors', 'Ranked competitors of a primary asset with the reason, basis (indication / mechanism), stage and indication coverage.', {
    asset_id: ASSET_ID,
  }, ['asset_id']),
  fn('compare_assets', 'Side-by-side comparison of 2-4 assets (mechanism, indications, approvals, trials, publications, latest event, next milestone). The app shows it as a table card.', {
    asset_ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
  }, ['asset_ids']),
  fn('search_evidence', 'Semantic search over the collected evidence text (news, press releases, publication and conference abstracts, prescribing information) of assets. Use for questions about results, data, statements or context.', {
    query: { type: 'string', description: 'What to look for, in natural language' },
    asset_ids: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Defaults to the asset in view and its competitors' },
    collections: { type: 'array', items: { type: 'string', enum: EVIDENCE_COLLECTIONS } },
    from: ISO_DATE,
    to: ISO_DATE,
    limit: { type: 'integer', minimum: 1, maximum: 12 },
  }, ['query']),
  fn('resolve_asset', 'Look up a drug that the user wants to add (track): identity card from FDA, EMA and ClinicalTrials.gov. The app shows the card with a "Confirm & start crawl" button; you never start crawls.', {
    name: { type: 'string', description: 'Drug name, brand or code name' },
  }, ['name']),
  fn('get_job_status', 'Progress of the latest data-collection (crawl) job of an asset, or of a job by id.', {
    asset_id: ASSET_ID,
    job_id: { type: 'string' },
  }),
];

/** One-line description of a call, shown while it runs. */
export function toolLabel(name: string, args: Record<string, unknown>): string {
  const a = (k: string) => (Array.isArray(args[k]) ? (args[k] as string[]).join(', ') : String(args[k] ?? ''));
  switch (name) {
    case 'search_assets':
      return args.query ? `Finding assets: ${a('query')}` : 'Listing tracked assets';
    case 'get_asset_overview':
      return `Reading the overview of ${a('asset_id')}`;
    case 'get_timeline':
      return `Reading the journey of ${a('asset_id')}`;
    case 'get_trials':
      return `Reading clinical trials of ${a('asset_id')}`;
    case 'get_regulatory':
      return `Reading the regulatory history of ${a('asset_id')}`;
    case 'get_patents':
      return `Reading the patents of ${a('asset_id')}`;
    case 'get_milestones':
      return 'Looking up upcoming milestones';
    case 'get_competitors':
      return `Reading competitors of ${a('asset_id')}`;
    case 'compare_assets':
      return `Comparing ${a('asset_ids')}`;
    case 'search_evidence':
      return `Searching evidence: ${a('query')}`;
    case 'resolve_asset':
      return `Looking up ${a('name')} in FDA, EMA and ClinicalTrials.gov`;
    case 'get_job_status':
      return 'Checking data collection progress';
    default:
      return name;
  }
}

@Injectable()
export class ChatTools {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly assets: AssetsService,
    private readonly competitorsView: CompetitorsService,
    private readonly crawler: CrawlerClient,
    private readonly llm: LlmService,
  ) {}

  async run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    try {
      switch (name) {
        case 'search_assets':
          return await this.searchAssets(args.query as string | undefined);
        case 'get_asset_overview':
          return await this.overview(String(args.asset_id), ctx);
        case 'get_timeline':
          return await this.timeline(args, ctx);
        case 'get_trials':
          return await this.trials(args, ctx);
        case 'get_regulatory':
          return await this.regulatory(String(args.asset_id), args.agency as string | undefined, ctx);
        case 'get_patents':
          return await this.patents(String(args.asset_id), args.query as string | undefined, ctx);
        case 'get_milestones':
          return await this.milestones(args, ctx);
        case 'get_competitors':
          return await this.competitors(String(args.asset_id));
        case 'compare_assets':
          return await this.compare((args.asset_ids as string[]) ?? [], ctx);
        case 'search_evidence':
          return await this.searchEvidence(args, ctx);
        case 'resolve_asset':
          return await this.resolve(String(args.name));
        case 'get_job_status':
          return await this.jobStatus(args.asset_id as string | undefined, args.job_id as string | undefined);
        default:
          return { result: { error: `Unknown tool ${name}` }, summary: 'unknown tool' };
      }
    } catch (err) {
      // The model gets the problem and can tell the user; the turn goes on.
      const message = err instanceof HttpException ? ((err.getResponse() as { message?: string }).message ?? err.message) : 'The tool failed.';
      return { result: { error: message }, summary: 'failed' };
    }
  }

  private async asset(id: string): Promise<AssetDoc> {
    return this.assets.getAsset(id);
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const docs = await this.db.collection<AssetDoc>('assets').find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray();
    return new Map(docs.map((d) => [d._id, d.name]));
  }

  /** The asset in view plus its competitors: the default scope of cross-asset tools. */
  private async scope(ctx: ToolContext, given?: unknown): Promise<string[]> {
    if (Array.isArray(given) && given.length) return given.map(String);
    if (!ctx.assetId) return [];
    const asset = await this.db.collection<AssetDoc>('assets').findOne({ _id: ctx.assetId }, { projection: { competitors: 1 } });
    return [ctx.assetId, ...(asset?.competitors ?? []).map((c) => c.id)];
  }

  private eventRef(e: Document, assetName: string, ctx: ToolContext): number | null {
    const src = (e.sources as { collection: string; record_key: string }[] | undefined)?.[0];
    if (!src) return null;
    return ctx.registry.ref({
      assetId: e.asset, assetName, collection: src.collection, recordKey: src.record_key,
      title: e.title, date: e.date ?? '', url: null,
    });
  }

  private eventForModel(e: Document, assetName: string, ctx: ToolContext) {
    return {
      ref: this.eventRef(e, assetName, ctx),
      asset: assetName,
      date: e.date,
      title: e.title,
      summary: clip(e.summary, 300),
      type: e.type,
      category: e.category,
      significance: e.significance,
      upcoming_milestone: e.is_milestone || undefined,
      phase: e.phase ?? undefined,
      indication: e.indication ?? undefined,
      region: e.region ?? undefined,
    };
  }

  private async searchAssets(query?: string): Promise<ToolOutput> {
    const match: Document = {};
    if (query) {
      const re = new RegExp(escapeRegex(query), 'i');
      match.$or = [{ name: re }, { aliases: re }, { 'company.name': re }, { 'tags.indications': re }, { 'tags.mechanism': re }];
    }
    const docs = await this.db.collection<AssetDoc>('assets').find(match).sort({ name: 1 }).limit(30).toArray();
    return {
      result: docs.map((d) => ({
        asset_id: d._id, name: d.name, aliases: d.aliases, company: d.company?.name, kind: d.kind, status: d.status,
        indications: d.tags?.indications, mechanism: d.tags?.mechanism, competitor_of: d.competitor_of,
      })),
      summary: plural(docs.length, 'asset'),
    };
  }

  private async overview(id: string, ctx: ToolContext): Promise<ToolOutput> {
    const detail = await this.assets.detail(id);
    const latest = await this.db
      .collection('journey_events')
      .find({ asset: id, is_milestone: false, significance: 'High' })
      .sort({ date: -1 })
      .limit(6)
      .toArray();
    return {
      result: {
        asset_id: detail.id, name: detail.name, aliases: detail.aliases, company: detail.company, tags: detail.tags,
        kind: detail.kind, status: detail.status, kpis: detail.kpis, record_counts: detail.counts,
        competitors: detail.competitors.map((c) => ({ asset_id: c.id, name: c.name, reason: c.reason, stage: c.stage })),
        competitor_of: detail.competitorOf,
        latest_high_significance_events: latest.map((e) => this.eventForModel(e, detail.name, ctx)),
      },
      summary: `${detail.counts.events} events, ${detail.counts.trials} trials`,
    };
  }

  private async timeline(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    const asset = await this.asset(String(args.asset_id));
    const match: Document = { asset: asset._id };
    if (Array.isArray(args.category) && args.category.length) match.category = { $in: args.category };
    if (Array.isArray(args.significance) && args.significance.length) match.significance = { $in: args.significance };
    if (args.from || args.to) match.date = { ...(args.from ? { $gte: args.from } : {}), ...(args.to ? { $lte: args.to } : {}) };
    if (typeof args.query === 'string' && args.query.trim()) {
      const re = new RegExp(args.query.trim().split(/\s+/).map(escapeRegex).join('|'), 'i');
      match.$or = [{ title: re }, { summary: re }];
    }
    const limit = Math.min(Number(args.limit) || 20, 40);
    const coll = this.db.collection('journey_events');
    const [events, total] = await Promise.all([coll.find(match).sort({ date: -1 }).limit(limit).toArray(), coll.countDocuments(match)]);
    return {
      result: { asset: asset.name, total_matching: total, events: events.map((e) => this.eventForModel(e, asset.name, ctx)) },
      summary: plural(events.length, 'event'),
    };
  }

  private async trials(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    const asset = await this.asset(String(args.asset_id));
    const match: Document = { assets: asset._id };
    const statuses = TRIAL_STATUS[String(args.status ?? 'all')];
    if (statuses) match.overall_status = { $in: statuses };
    if (args.phase) match.phases = args.phase;
    if (typeof args.query === 'string' && args.query.trim()) {
      const re = new RegExp(escapeRegex(args.query.trim()), 'i');
      match.$or = ['title', 'acronym', 'nct_id', 'lead_sponsor', 'conditions'].map((f) => ({ [f]: re }));
    }
    const limit = Math.min(Number(args.limit) || 15, 30);
    const coll = this.db.collection('trial_records');
    const [trials, total] = await Promise.all([
      coll
        .find(match, { projection: { study: 0 } })
        .sort({ date: -1 })
        .limit(limit)
        .toArray(),
      coll.countDocuments(match),
    ]);
    return {
      result: {
        asset: asset.name,
        total_matching: total,
        trials: trials.map((t) => ({
          ref: ctx.registry.ref({
            assetId: asset._id, assetName: asset.name, collection: 'trial_records', recordKey: t.record_key,
            title: [t.acronym, t.title].filter(Boolean).join(': '), date: t.start_date ?? t.date ?? '', url: t.url ?? null,
          }),
          nct_id: t.nct_id, acronym: t.acronym, title: t.title, phases: t.phases, status: t.overall_status,
          sponsor: t.lead_sponsor, start: t.start_date, primary_completion: t.primary_completion_date,
          enrollment: t.enrollment, conditions: (t.conditions ?? []).slice(0, 4), has_results: t.has_results,
          why_stopped: t.why_stopped ?? undefined,
        })),
      },
      summary: plural(trials.length, 'trial'),
    };
  }

  private async regulatory(id: string, agency: string | undefined, ctx: ToolContext): Promise<ToolOutput> {
    const asset = await this.asset(id);
    const match: Document = { asset: id, origin: 'rule', category: { $in: ['regulatory', 'safety'] } };
    if (agency) match.region = agency === 'FDA' ? 'US' : 'EU';
    const events = await this.db.collection('journey_events').find(match).sort({ date: -1 }).limit(40).toArray();
    return {
      result: { asset: asset.name, events: events.map((e) => this.eventForModel(e, asset.name, ctx)) },
      summary: plural(events.length, 'regulatory event'),
    };
  }

  private async patents(id: string, query: string | undefined, ctx: ToolContext): Promise<ToolOutput> {
    const asset = await this.asset(id);
    const coll = this.db.collection('patent_records');
    const match: Document = { assets: id };
    if (query?.trim()) match.title = new RegExp(query.trim().split(/\s+/).map(escapeRegex).join('|'), 'i');
    const inForceUs: Document = { ...match, country: 'US', kind: /^B/, legal_status: { $in: ['Active', 'Granted'] }, expiry_date: { $gt: today() } };
    const count = async (field: string, m: Document) =>
      Object.fromEntries(
        (await coll.aggregate<{ _id: string | null; n: number }>([{ $match: m }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray())
          .map((r) => [r._id ?? 'unknown', r.n]),
      );
    const projection = { record_key: 1, publication_number: 1, title: 1, expiry_date: 1, grant_date: 1, assignees: 1, url: 1 };
    const [byStatus, usByStatus, byYear, first, last] = await Promise.all([
      count('legal_status', match),
      count('legal_status', { ...match, country: 'US' }),
      coll
        .aggregate<{ _id: string; n: number }>([{ $match: inForceUs }, { $group: { _id: { $substrBytes: ['$expiry_date', 0, 4] }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }])
        .toArray(),
      coll.find(inForceUs, { projection }).sort({ expiry_date: 1 }).limit(12).toArray(),
      coll.find(inForceUs, { projection }).sort({ expiry_date: -1 }).limit(8).toArray(),
    ]);
    const view = (p: Document) => ({
      ref: ctx.registry.ref({
        assetId: id, assetName: asset.name, collection: 'patent_records', recordKey: p.record_key,
        title: `${p.publication_number}: ${p.title}`, date: p.expiry_date ?? '', url: p.url ?? null,
      }),
      number: p.publication_number, title: p.title, expires: p.expiry_date, granted: p.grant_date, assignees: p.assignees,
    });
    const usInForce = byYear.reduce((n, y) => n + y.n, 0);
    const lastSet = new Set(last.map((p) => p.record_key));
    return {
      result: {
        asset: asset.name,
        all_countries: { total: Object.values(byStatus).reduce((n, v) => n + v, 0), by_legal_status: byStatus },
        us: { total: Object.values(usByStatus).reduce((n, v) => n + v, 0), by_legal_status: usByStatus, granted_in_force_not_expired: usInForce },
        us_in_force_expiries_by_year: Object.fromEntries(byYear.map((y) => [y._id, y.n])),
        last_us_expiry: last[0] ? view(last[0]) : null,
        first_us_expiries: first.filter((p) => !lastSet.has(p.record_key)).map(view),
        last_us_expiries: last.reverse().map(view),
      },
      summary: `${usInForce} US patents in force`,
    };
  }

  private async milestones(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    let ids = await this.scope(ctx, args.asset_ids);
    if (!ids.length) {
      ids = (await this.db.collection<AssetDoc>('assets').find({ kind: 'primary' }, { projection: { _id: 1 } }).toArray()).map((a) => a._id);
    }
    const until = new Date();
    until.setMonth(until.getMonth() + (Number(args.months_ahead) || 24));
    const events = await this.db
      .collection('journey_events')
      .find({ asset: { $in: ids }, is_milestone: true, date: { $gte: today(), $lte: until.toISOString().slice(0, 10) } })
      .sort({ date: 1 })
      .limit(30)
      .toArray();
    const names = await this.names(ids);
    const nameOf = (id: string) => names.get(id) ?? id;
    const card: Card = {
      type: 'timeline',
      title: 'Upcoming milestones',
      assetId: ctx.assetId ?? ids[0]!,
      events: events.slice(0, 8).map((e) => ({
        id: String(e._id), assetId: e.asset, assetName: nameOf(e.asset), date: e.date, title: e.title,
        category: e.category, significance: e.significance, is_milestone: true, sources: e.sources ?? [],
      })),
    };
    return {
      result: { milestones: events.map((e) => this.eventForModel(e, nameOf(e.asset), ctx)) },
      summary: plural(events.length, 'milestone'),
      cards: events.length ? [card] : [],
    };
  }

  private async competitors(id: string): Promise<ToolOutput> {
    const asset = await this.asset(id);
    const ranked = asset.competitors ?? [];
    const statuses = new Map(
      (await this.db.collection<AssetDoc>('assets').find({ _id: { $in: ranked.map((c) => c.id) } }, { projection: { status: 1 } }).toArray())
        .map((d) => [d._id, d.status]),
    );
    return {
      result: {
        asset: asset.name,
        identified: ranked.length > 0,
        competitors: ranked.map((c, i) => ({
          rank: i + 1, asset_id: c.id, name: c.name, company: c.company, reason: c.reason, basis: c.basis, stage: c.stage,
          indication_coverage: c.coverage, other_indications: c.other_indications, data_status: statuses.get(c.id) ?? 'onboarding',
        })),
      },
      summary: plural(ranked.length, 'competitor'),
    };
  }

  private async compare(ids: string[], ctx: ToolContext): Promise<ToolOutput> {
    const view = await Promise.all(ids.slice(0, 4).map((id) => this.compareOne(id, ctx)));
    const card: Card = {
      type: 'comparison',
      title: view.map((v) => v.name).join(' versus '),
      columns: view.map((v) => ({ id: v.asset_id, name: v.name, company: v.company })),
      rows: [
        { label: 'Mechanism', values: view.map((v) => v.mechanism || '—') },
        { label: 'Modality', values: view.map((v) => v.modality || '—') },
        { label: 'Approved indications', values: view.map((v) => v.indications.join(', ') || '—') },
        { label: 'Investigational', values: view.map((v) => v.investigational.join(', ') || '—') },
        { label: 'Approved in', values: view.map((v) => v.approved_in.join(', ') || '—') },
        { label: 'First approval', values: view.map((v) => v.first_approval || '—') },
        { label: 'Active trials (Phase 3)', values: view.map((v) => `${v.active_trials} (${v.active_phase3})`) },
        { label: 'Publications', values: view.map((v) => String(v.publications)) },
        { label: 'Latest milestone', values: view.map((v) => (v.latest_event ? `${v.latest_event.title} (${v.latest_event.date.slice(0, 4)})` : '—')) },
        { label: 'Next milestone', values: view.map((v) => (v.next_milestone ? `${v.next_milestone.title} (${v.next_milestone.date})` : '—')) },
      ],
    };
    return { result: view, summary: `${view.length} assets`, cards: [card] };
  }

  private async compareOne(id: string, ctx: ToolContext) {
    const detail = await this.assets.detail(id);
    const events = this.db.collection('journey_events');
    const [first, latest, next] = await Promise.all([
      events.find({ asset: id, origin: 'rule', type: 'approval', date: { $ne: '' } }).sort({ date: 1 }).limit(1).next(),
      events.find({ asset: id, is_milestone: false, significance: 'High' }).sort({ date: -1 }).limit(1).next(),
      events.find({ asset: id, is_milestone: true, date: { $gte: today() } }).sort({ date: 1 }).limit(1).next(),
    ]);
    const brief = (e: Document | null) => (e ? { ...this.eventForModel(e, detail.name, ctx), date: String(e.date) } : null);
    return {
      asset_id: detail.id,
      name: detail.name,
      company: detail.company.name,
      mechanism: detail.tags.mechanism ?? '',
      modality: detail.tags.modality ?? '',
      indications: detail.tags.indications ?? [],
      investigational: detail.tags.investigational_indications ?? [],
      approved_in: detail.kpis.approvalRegions,
      first_approval: (first?.date as string | undefined) ?? null,
      active_trials: detail.kpis.activeTrials,
      active_phase3: detail.kpis.activePhase3,
      trials_total: detail.counts.trials,
      publications: detail.counts.publications,
      latest_event: brief(latest),
      next_milestone: brief(next),
      data_status: detail.status,
    };
  }

  private async searchEvidence(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    const query = String(args.query ?? '').trim();
    if (!query) return { result: { error: 'Empty query' }, summary: 'no query' };
    const ids = await this.scope(ctx, args.asset_ids);
    const filter: Document = {};
    if (ids.length) filter.assets = { $in: ids };
    if (Array.isArray(args.collections) && args.collections.length) filter.collection = { $in: args.collections };
    if (args.from || args.to) filter.date = { ...(args.from ? { $gte: args.from } : {}), ...(args.to ? { $lte: args.to } : {}) };
    const limit = Math.min(Number(args.limit) || 8, 12);
    const vector = await this.llm.embed(query);
    const hits = await this.db
      .collection('record_chunks')
      .aggregate([
        {
          $vectorSearch: {
            index: 'record_chunks_vector', path: 'embedding', queryVector: vector,
            numCandidates: 200, limit: limit * 3, ...(Object.keys(filter).length ? { filter } : {}),
          },
        },
        { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray();
    // At most two passages per record, so one long document doesn't crowd out the rest.
    const perRecord = new Map<string, number>();
    const kept = hits.filter((h) => {
      const key = `${h.collection}|${h.record_key}`;
      perRecord.set(key, (perRecord.get(key) ?? 0) + 1);
      return perRecord.get(key)! <= 2;
    }).slice(0, limit);
    const assetIds = [...new Set(kept.flatMap((h) => (h.assets as string[]) ?? []))];
    const names = await this.names(assetIds);
    const passages = kept.map((h) => {
      const assetId = (h.assets as string[]).find((a) => !ids.length || ids.includes(a)) ?? (h.assets as string[])[0]!;
      return {
        ref: ctx.registry.ref({
          assetId, assetName: names.get(assetId) ?? assetId, collection: h.collection, recordKey: h.record_key,
          title: h.title ?? '', date: h.date ?? '', url: h.url ?? null, recordType: h.record_type,
        }),
        asset: names.get(assetId) ?? assetId,
        title: h.title,
        date: h.date,
        kind: h.record_type,
        text: clip(h.text, 1100),
      };
    });
    return { result: { passages }, summary: plural(passages.length, 'passage') };
  }

  private async resolve(name: string): Promise<ToolOutput> {
    try {
      const identity = await this.crawler.resolve(name);
      const i = identity as {
        name: string; company?: { name?: string }; exists?: boolean; existing?: { kind?: string } | null;
        website_verified?: boolean; tags?: unknown; plan_summary?: string; notes?: string[];
      };
      return {
        result: {
          found: true, name: i.name, company: i.company?.name, tags: i.tags, website_verified: i.website_verified,
          already_tracked: i.exists ?? false, tracked_as: i.existing?.kind ?? null, plan: i.plan_summary, notes: i.notes,
          shown_to_user: 'identity card with Confirm & start crawl',
        },
        summary: i.exists ? 'already tracked' : `found ${i.name}`,
        cards: [{ type: 'identity', identity }],
      };
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 404) {
        return { result: { found: false, message: `No drug matching "${name}" was found in FDA, EMA or ClinicalTrials.gov.` }, summary: 'not found' };
      }
      throw err;
    }
  }

  private async jobStatus(assetId?: string, jobId?: string): Promise<ToolOutput> {
    const match: Document = jobId ? { _id: jobId } : { asset: assetId };
    const job = await this.db.collection('jobs').find(match).sort({ created_at: -1 }).limit(1).next();
    if (!job) return { result: { error: 'No data collection job found' }, summary: 'no job' };
    const asset = await this.db.collection<AssetDoc>('assets').findOne({ _id: job.asset }, { projection: { name: 1 } });
    const steps = (job.steps ?? []) as { label: string; status: string; error?: string | null }[];
    const finished = steps.filter((s) => ['done', 'failed', 'skipped'].includes(s.status)).length;
    return {
      result: {
        job_id: job._id, asset: asset?.name ?? job.asset, type: job.type, status: job.status,
        progress: `${finished}/${steps.length} steps`, started_at: job.started_at, finished_at: job.finished_at,
        steps: steps.map((s) => ({ step: s.label, status: s.status, error: s.error ?? undefined })),
      },
      summary: `${job.status}, ${finished}/${steps.length} steps`,
      cards: [{ type: 'job', jobId: String(job._id), assetId: job.asset, assetName: asset?.name ?? job.asset }],
    };
  }
}
