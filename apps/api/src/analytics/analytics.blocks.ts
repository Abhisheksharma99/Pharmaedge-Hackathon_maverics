import type { Document } from 'mongodb';

/** Pure aggregations behind the Analytics tab (README §7.1); unit-tested, no I/O. */
export const STAGES = ['Phase 1', 'Phase 2', 'Phase 3', 'Filed', 'Approved'] as const;
const APPROVED = new Set(['approval', 'label_expansion', 'new_formulation']);
const FILED = new Set(['regulatory_submission', 'regulatory_decision_expected', 'regulatory_opinion']);
const ACTIVE = new Set(['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION']);
const CATEGORIES = [
  ['regulatory', 'Regulatory'],
  ['clinical', 'Clinical'],
  ['safety', 'Safety'],
  ['company', 'Company'],
  ['ip', 'Patents'],
] as const;
const brief = (e: Document) => ({ id: e._id ?? e.id, title: e.title as string, date: e.date as string });
const phaseIndex = (phase: unknown) => {
  const m = /PHASE(\d)/.exec(String(phase ?? ''));
  return m ? Math.min(2, Number(m[1]) - 1) : -1;
};

export interface PipelineRow {
  id: string;
  label: string;
  full: string;
  color: string | null;
  ended: string | null;
  stage: number;
  n: number;
  next: { id: string; title: string; date: string } | null;
  since: string | null;
}

export function pipeline(branches: Document[], events: Document[], asset: Document, today: string): PipelineRow[] {
  const row = (id: string, label: string, full: string, color: string | null, ended: string | null, evs: Document[], approved: boolean): PipelineRow => {
    let stage = approved || evs.some((e) => APPROVED.has(e.type) && !e.is_milestone) ? 4 : evs.some((e) => FILED.has(e.type)) ? 3 : Math.max(0, ...evs.map((e) => phaseIndex(e.phase)));
    if (stage < 0) stage = 0;
    const next = evs.filter((e) => e.is_milestone && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const since = evs.filter((e) => !e.is_milestone && e.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    return { id, label, full, color, ended, stage, n: evs.length, next: next ? brief(next) : null, since: since?.date ?? null };
  };
  if (branches.length) {
    const trunk = branches.find((b) => b.trunk)?.id;
    return branches.map((b) => row(b.id, b.label ?? b.id, b.full ?? b.id, b.color ?? null, b.ended ?? null, events.filter((e) => (e.branch ?? trunk) === b.id), false));
  }
  const tags = asset.tags ?? {};
  return [
    ...(tags.indications ?? []).map((i: string) => row(i, i, i, null, null, [], true)),
    ...(tags.investigational_indications ?? []).map((i: string) => row(i, i, i, null, null, [], false)),
  ];
}

export function activityByYear(events: Document[]) {
  const years = events.map((e) => Number(String(e.date ?? '').slice(0, 4))).filter((y) => y > 1900);
  if (!years.length) return { cols: [] as number[], series: CATEGORIES.map(([k, l]) => ({ k, l, vals: [] as number[] })) };
  const from = Math.min(...years);
  const cols = Array.from({ length: Math.max(...years) - from + 1 }, (_, i) => from + i);
  return {
    cols,
    series: CATEGORIES.map(([k, l]) => ({ k, l, vals: cols.map((y) => events.filter((e) => e.category === k && String(e.date).startsWith(String(y))).length) })),
  };
}

export function significanceMix(events: Document[]) {
  return { High: events.filter((e) => e.significance === 'High').length, Medium: events.filter((e) => e.significance === 'Medium').length, Low: events.filter((e) => e.significance === 'Low').length };
}

export function landscape(asset: Document, competitors: Document[]) {
  const tags = asset.tags ?? {};
  const cols: string[] = [...(tags.indications ?? []), ...(tags.investigational_indications ?? [])];
  const me = Object.fromEntries(cols.map((c) => [c, (tags.indications ?? []).includes(c) ? 'approved' : 'investigational']));
  return {
    cols,
    rows: [
      { id: asset._id ?? null, name: asset.name, company: asset.company?.name ?? null, me: true, cells: me },
      ...competitors.map((c) => ({ id: c.id, name: c.name, company: c.company ?? null, me: false, cells: Object.fromEntries(cols.map((col) => [col, c.coverage?.[col] ?? 'none'])) })),
    ],
  };
}

export function trialRows(records: Document[], company: string | undefined) {
  const co = (company ?? '').toLowerCase();
  return records
    .map((r) => {
      const idx = Math.max(-1, ...(r.phases ?? []).map((p: string) => (/PHASE(\d)/.exec(p) ? Number(/PHASE(\d)/.exec(p)![1]) : -1)));
      return {
        nct: r.nct_id as string,
        name: (r.acronym as string) || (r.nct_id as string),
        title: (r.title as string) ?? '',
        phase: idx > 0 ? `Phase ${idx}` : 'N/A',
        status: (r.overall_status as string) ?? '',
        start: (r.start_date as string) ?? '',
        pcd: (r.primary_completion_date as string) || (r.completion_date as string) || '',
        enrollment: Number(r.enrollment) || 0,
        indication: (r.conditions?.[0] as string) ?? '',
        company: !!co && String(r.lead_sponsor ?? '').toLowerCase().includes(co),
        active: ACTIVE.has(r.overall_status),
      };
    })
    .sort((a, b) => b.start.localeCompare(a.start));
}

export function patentRows(records: Document[], today: string) {
  return records
    .map((r) => ({
      number: r.publication_number as string,
      title: (r.title as string) ?? '',
      granted: (r.grant_date as string) ?? '',
      expiry: (r.expiry_date as string) ?? '',
      status: (r.legal_status as string) ?? '',
      invalidated: /revoked|invalid/i.test(String(r.legal_status ?? '')),
      expired: !!r.expiry_date && r.expiry_date < today,
    }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

export function stats(
  input: { pipeline: PipelineRow[]; trials: ReturnType<typeof trialRows>; events: Document[]; patents: ReturnType<typeof patentRows>; evidenceRecords: number },
  today: string,
) {
  const active = input.trials.filter((t) => t.active && t.company);
  const next = input.events.filter((e) => e.is_milestone && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const inForce = input.patents.filter((p) => !p.invalidated && p.expiry > today);
  const runway = inForce.length ? (Date.parse(inForce.at(-1)!.expiry) - Date.parse(today)) / (365.25 * 86_400_000) : null;
  return {
    approvedIndications: input.pipeline.filter((p) => p.stage === 4).length,
    inDevelopment: input.pipeline.filter((p) => p.stage < 4 && !p.ended).map((p) => p.label),
    activeTrials: active.length,
    phase3: active.filter((t) => t.phase === 'Phase 3').length,
    patients: active.reduce((s, t) => s + t.enrollment, 0),
    nextCatalyst: next ? brief(next) : null,
    patentRunwayYears: runway === null ? null : Math.round(runway * 10) / 10,
    evidenceRecords: input.evidenceRecords,
  };
}
