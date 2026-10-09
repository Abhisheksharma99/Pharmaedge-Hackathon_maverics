const { useState: oS, useEffect: oE } = React;

/* Analytics cards a user can pin to an asset's Overview. "index" = computed from records already crawled and
   chunked; "web" = needs a public web search first (see ANALYTICS_PIPELINE.md). */
const OV_TEMPLATES = {
  pipeline: { t: 'Development pipeline', d: 'Furthest stage per indication', span: 2, src: 'index', basis: 'trials, filings, approvals', r: (a, b, evs) => <PipelineMatrix rows={pipelineFor(a, evs)} /> },
  activity: { t: 'Journey activity by year', d: 'Events per year by category', span: 2, src: 'index', basis: 'journey events', r: (a, b, evs) => { const y0 = Math.min(...evs.map((e) => +e.date.slice(0, 4))), ys = Array.from({ length: Math.max(...evs.map((e) => +e.date.slice(0, 4))) - y0 + 1 }, (_, i) => y0 + i); return <StackBars h={120} cols={ys} every={ys.length > 16 ? 3 : 1} series={Object.entries(AJ.CAT).map(([k, m]) => ({ k, l: m.label, c: m.c, vals: ys.map((y) => evs.filter((e) => e.category === k && +e.date.slice(0, 4) === y).length) }))} />; } },
  milestones: { t: 'Next milestones', d: 'Expected readouts, decisions and expiries', span: 1, src: 'index', basis: 'trial dates, FDA calendar, patents', r: (a, b, evs) => { const up = evs.filter((e) => e.is_milestone).sort((x, z) => x.date.localeCompare(z.date)); return up.length ? <ul className="ov-ms">{up.slice(0, 4).map((e) => <li key={e.id}><span className="ov-d"><b>{fmtMonth(e.date).split(' ')[0]}</b><span>{e.date.slice(0, 4)}</span></span><span className="ov-mt">{e.title}<em>{relFuture(e.date)}</em></span></li>)}</ul> : <p className="muted">No expected milestones.</p>; } },
  sig: { t: 'Significance mix', span: 1, src: 'index', basis: 'journey events', r: (a, b, evs) => <Donut size={120} data={['High', 'Medium', 'Low'].map((s, i) => ({ l: s, v: evs.filter((e) => e.significance === s).length, c: ['#b42318', '#dc8a0e', '#98a2b3'][i] }))} sub="events" /> },
  trialsPhase: { t: 'Trials by phase', span: 1, src: 'index', basis: 'ClinicalTrials.gov records', need: 'clinical', r: (a) => { const t = PE_REC[a.id].clinical; return <VBars h={110} data={['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map((p) => ({ l: p.replace('Phase ', 'P'), v: t.filter((x) => x.phase === p).length, c: PHASE_C[p] }))} />; } },
  enrol: { t: 'Enrolment by indication', span: 1, src: 'index', basis: 'ClinicalTrials.gov records', need: 'clinical', r: (a) => <HBars data={Object.entries(PE_REC[a.id].clinical.reduce((m, t) => ((m[t.ind] = (m[t.ind] || 0) + t.n), m), {})).sort((x, z) => z[1] - x[1]).slice(0, 6).map(([l, v], i) => ({ l, v, c: ['#2347d9', '#0b7a6f', '#6941c6', '#e0620f', '#5873e8', '#98a2b3'][i] }))} /> },
  trials: { t: 'Clinical trial timeline', span: 2, src: 'index', basis: 'ClinicalTrials.gov records', need: 'clinical', r: (a) => <Gantt from={2004} to={2028} rows={[...PE_REC[a.id].clinical].sort((x, z) => x.start.localeCompare(z.start)).filter((t) => t.co).map((t) => ({ l: t.name, sub: t.ind, s: yfrac(t.start + '-01'), e: yfrac(t.pcd + '-28'), c: PHASE_C[t.phase], tag: t.phase.replace('Phase ', 'P'), dash: /terminat/i.test(t.status) }))} /> },
  patents: { t: 'Patent runway', span: 2, src: 'index', basis: 'patent records', need: 'patents', r: (a) => <Gantt from={1992} to={2044} rows={PE_REC[a.id].patents.map((p) => ({ l: p.num, sub: p.prod, s: yfrac(p.granted), e: yfrac(p.expiry), c: /invalid/i.test(p.status) ? '#b42318' : p.expiry < AJ.TODAY ? '#98a2b3' : '#6941c6', dash: /invalid/i.test(p.status), tag: p.expiry.slice(0, 4) }))} /> },
  sources: { t: 'Source mix', span: 1, src: 'index', basis: 'stored records', live: true, r: (a, b) => <Donut size={120} data={Object.keys(AJ.COLL).map((k) => ({ l: k.replace('_records', ''), v: b.records.filter((r) => r.coll === k).length, c: AJ.COLL[k].c })).filter((d) => d.v)} sub="records" /> },
  landscape: { t: 'Competitive landscape', span: 2, src: 'index', basis: 'competitor journeys', r: (a) => { const comps = PE.ASSETS.filter((c) => c.competitorOf.includes(a.id)), inds = [...a.indications, ...a.investigational]; return <Heat cols={inds} rows={[{ l: a.name, sub: 'this asset', ...a }, ...comps.map((c) => ({ l: c.name, sub: c.company, ...c }))]} cell={(r, c) => r.indications.includes(c) ? { label: 'Approved', bg: '#e6f4f2', fg: '#0b7a6f' } : r.investigational.includes(c) ? { label: 'In trials', bg: '#fffaeb', fg: '#b54708' } : { label: '—', bg: '#f9fafb', fg: '#98a2b3' }} />; } },
};
const OV_DEFAULT = (a) => (PE_REC[a.id] ? ['pipeline', 'milestones', 'activity', 'trialsPhase', 'enrol'] : ['activity', 'milestones', 'sig']);

/* Canned results for the AI pipeline (prototype). */
const AI_SUGGEST = (a) => a.id !== 'treprostinil' ? [
  { id: 'cal', t: 'Competitor milestone calendar', why: 'Competitors have readouts in the next 18 months', src: 'index', n: 14, kind: 'cal' },
  { id: 'faers', t: 'Adverse event reports over time (FAERS)', why: 'No safety series is indexed for this asset yet', src: 'web', n: 0, kind: 'faers', sources: ['open.fda.gov · drug/event API'] },
] : [
  { id: 'tta', t: 'Time from Phase 3 start to approval', why: '4 programmes have both a pivotal trial and a decision in the index', src: 'index', n: 8, kind: 'tta' },
  { id: 'label', t: 'Label evolution by indication', why: 'Label changes across 4 products are already on the journey', src: 'index', n: 11, kind: 'label' },
  { id: 'cal', t: 'Competitor milestone calendar', why: 'Yutrepia and Ofev journeys have upcoming dates', src: 'index', n: 9, kind: 'cal' },
  { id: 'rev', t: 'Net revenue by product', why: 'Not crawled; available in public 10-K filings', src: 'web', n: 0, kind: 'rev', sources: ['sec.gov · United Therapeutics 10-K 2021–2025', 'ir.unither.com · quarterly results'] },
  { id: 'faers', t: 'Adverse event reports over time (FAERS)', why: 'Public FDA adverse-event data, not yet indexed', src: 'web', n: 0, kind: 'faers', sources: ['open.fda.gov · drug/event API'] },
  { id: 'share', t: 'Prescription share vs Yutrepia', why: 'Needs licensed prescription data; public sources are partial', src: 'limited', n: 0, kind: 'none', sources: ['Company earnings calls (partial)', 'IQVIA (licensed, not connected)'] },
];
function aiResult(kind, a) {
  if (kind === 'tta') return { t: 'Time from Phase 3 start to approval', unit: ' yrs', chart: 'hbar', data: [{ l: 'Tyvaso · PAH (TRIUMPH I)', v: 4.2, c: '#2347d9' }, { l: 'Orenitram · PAH (FREEDOM-M)', v: 7.3, c: '#2347d9' }, { l: 'Tyvaso · PH-ILD (INCREASE)', v: 4.2, c: '#0b7a6f' }, { l: 'Tyvaso · IPF (TETON-1) · pending', v: 6.1, c: '#6941c6' }], sources: ['trial_records · NCT00147199, NCT00325442, NCT02630316, NCT04708782', 'fda_records · NDA022387, NDA203496, NDA022387 S-017', 'fda_records · PDUFA calendar (IPF)'], method: 'index', note: 'IPF uses the expected PDUFA date.' };
  if (kind === 'label') return { t: 'Label evolution by indication', chart: 'bars', data: [{ l: 'Remodulin', v: 4, c: '#2347d9' }, { l: 'Tyvaso', v: 3, c: '#0b7a6f' }, { l: 'Orenitram', v: 2, c: '#e0620f' }, { l: 'Tyvaso DPI', v: 2, c: '#6941c6' }], sources: ['fda_records · 11 approval and labeling supplements'], method: 'index' };
  if (kind === 'cal') return { t: 'Competitor milestone calendar', chart: 'list', data: PE.EV.filter((e) => e.is_milestone && PE.byId[e.asset].kind === 'competitor').concat(AJ.EVENTS.filter((e) => e.is_milestone).slice(0, 2).map((e) => ({ ...e, asset: 'treprostinil' }))).sort((x, z) => x.date.localeCompare(z.date)).map((e) => ({ l: e.title, sub: `${PE.byId[e.asset].name} · ${relFuture(e.date)}`, d: e.date })), sources: ['Competitor journeys · trial_records, fda_records'], method: 'index' };
  if (kind === 'rev') return { t: 'Net revenue by product ($M)', chart: 'stack', cols: [2021, 2022, 2023, 2024, 2025], series: [{ k: 'dpi', l: 'Tyvaso DPI', c: '#6941c6', vals: [0, 230, 610, 980, 1240] }, { k: 'ty', l: 'Tyvaso (neb.)', c: '#0b7a6f', vals: [480, 470, 420, 380, 340] }, { k: 'rem', l: 'Remodulin', c: '#2347d9', vals: [480, 470, 500, 520, 510] }, { k: 'ore', l: 'Orenitram', c: '#e0620f', vals: [320, 330, 380, 430, 470] }], sources: ['sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1082554&type=10-K', 'ir.unither.com/financial-information/quarterly-results'], method: 'web', note: 'Sample values for the prototype. Verify against the filings before use.' };
  if (kind === 'faers') return { t: 'Adverse event reports per year (FAERS)', chart: 'stack', cols: [2019, 2020, 2021, 2022, 2023, 2024, 2025], series: [{ k: 's', l: 'Serious', c: '#b42318', vals: [410, 450, 520, 610, 680, 720, 760] }, { k: 'n', l: 'Non-serious', c: '#98a2b3', vals: [620, 640, 700, 790, 860, 900, 930] }], sources: ['api.fda.gov/drug/event.json?search=patient.drug.openfda.generic_name:"treprostinil"'], method: 'web', note: 'Sample counts for the prototype. FAERS reports are not incidence rates.' };
  return { t: 'Not enough public data', chart: 'none', sources: [], method: 'none', note: 'Prescription share needs licensed data (e.g. IQVIA). Connect a data source, or I can track share signals mentioned in earnings calls instead.' };
}
function AiChart({ r }) {
  if (r.chart === 'hbar') return <HBars data={r.data} unit={r.unit} />;
  if (r.chart === 'bars') return <VBars h={110} data={r.data} />;
  if (r.chart === 'stack') return <StackBars h={120} cols={r.cols} series={r.series} />;
  if (r.chart === 'list') return <ul className="ov-ms">{r.data.slice(0, 5).map((x) => <li key={x.l}><span className="ov-d"><b>{fmtMonth(x.d).split(' ')[0]}</b><span>{x.d.slice(0, 4)}</span></span><span className="ov-mt">{x.l}<em>{x.sub}</em></span></li>)}</ul>;
  return <p className="ov-none"><Icon name="alert" size={14} />{r.note}</p>;
}
const SRC_B = { index: ['From indexed data', 'ok'], web: ['Needs web search', 'warn'], limited: ['Limited public data', 'bad'] };

function AddAnalytics({ a, b, pinned, onAdd, onClose }) {
  const [tab, setTab] = oS('suggest');
  const [q, setQ] = oS('');
  const [run, setRun] = oS(null);
  const sugg = AI_SUGGEST(a);
  const avail = Object.entries(OV_TEMPLATES).filter(([k, t]) => (!t.need || (PE_REC[a.id] && PE_REC[a.id][t.need])) && (!t.live || a.id === 'treprostinil'));
  const start = (kind, title, srcKind) => {
    const steps = srcKind === 'web' ? ['Searching the index (1,240 passages)', 'Not enough indexed data, searching public sources', 'Extracting values and citing sources', 'Building the chart'] : srcKind === 'limited' ? ['Searching the index (1,240 passages)', 'Searching public sources', 'Checking data coverage'] : ['Searching the index (1,240 passages)', 'Extracting values from matched records', 'Building the chart'];
    setRun({ kind, title, steps, i: 0, res: null });
    steps.forEach((_, i) => setTimeout(() => setRun((r) => r && { ...r, i: i + 1 }), 550 * (i + 1)));
    setTimeout(() => setRun((r) => r && { ...r, res: aiResult(kind, a) }), 550 * steps.length + 250);
  };
  const ask = () => { const s = q.toLowerCase(); const kind = /revenue|sales|\$/.test(s) ? 'rev' : /adverse|faers|safety/.test(s) ? 'faers' : /share|prescri|trx|nbrx/.test(s) ? 'none' : /competitor|calendar/.test(s) ? 'cal' : /label/.test(s) ? 'label' : 'tta'; start(kind, q, kind === 'rev' || kind === 'faers' ? 'web' : kind === 'none' ? 'limited' : 'index'); };
  oE(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return ReactDOM.createPortal(
    <div className="nc-ov" onMouseDown={onClose}>
      <div className="aa" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Add analytics">
        <div className="nc-h"><span className="tile sm nc-ic"><Icon name="chart" size={14} /></span><div><b>Add analytics to the Overview</b><span>Built from data we’ve already indexed. Public web sources are used only when the index is missing something.</span></div><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button></div>
        {!run && <div className="aa-tabs"><Seg label="Mode" value={tab} onChange={setTab} options={[{ value: 'suggest', label: 'Suggested by AI', icon: 'sparkles' }, { value: 'lib', label: 'From your data' }, { value: 'ask', label: 'Ask for an analysis' }]} /></div>}
        <div className="aa-b">
          {run ? (
            <div className="aa-run">
              <p className="aa-q"><Icon name="sparkles" size={14} />{run.title}</p>
              {run.steps.map((s, i) => <div key={s} className={'nc-st' + (run.i > i ? ' done' : run.i === i ? ' run' : '')}>{run.i > i ? <Icon name="check" size={13} sw={2.6} /> : run.i === i ? <Icon name="loader" size={13} className="spin" /> : <Icon name="dashed" size={13} />}{s}</div>)}
              {run.res && (
                <div className="aa-res">
                  <div className="aa-rh"><b>{run.res.t}</b><span className={'srcb ' + (run.res.method === 'web' ? 'warn' : run.res.method === 'none' ? 'bad' : 'ok')}>{run.res.method === 'web' ? 'Public web sources' : run.res.method === 'none' ? 'Not available' : 'Indexed data · no new crawl'}</span></div>
                  <AiChart r={run.res} />
                  {run.res.note && run.res.chart !== 'none' && <p className="aa-note"><Icon name="alert" size={12} />{run.res.note}</p>}
                  {run.res.sources.length > 0 && <div className="aa-src"><span className="sh-lbl">Sources</span>{run.res.sources.map((s) => <span key={s} className="mono">{s}</span>)}</div>}
                  <div className="nc-ft"><button className="btn btn-sm" onClick={() => setRun(null)}>Back</button><span className="sp"></span>{run.res.chart !== 'none' && <button className="btn btn-sm btn-p" onClick={() => { onAdd({ custom: { ...run.res, id: 'c-' + Date.now() } }); onClose(); }}><Icon name="plus" size={14} />Add to Overview</button>}</div>
                </div>
              )}
            </div>
          ) : tab === 'suggest' ? (
            <ul className="aa-list">{sugg.map((s) => (
              <li key={s.id}><div className="aa-m"><b>{s.t}</b><span>{s.why}</span>{s.sources && <span className="mono aa-s">{s.sources.join(' · ')}</span>}</div><span className={'srcb ' + SRC_B[s.src][1]}>{SRC_B[s.src][0]}{s.n ? ` · ${s.n} records` : ''}</span><button className="btn btn-sm" onClick={() => start(s.kind, s.t, s.src)}>{s.src === 'index' ? 'Build' : 'Search & build'}</button></li>
            ))}</ul>
          ) : tab === 'lib' ? (
            <ul className="aa-list">{avail.map(([k, t]) => { const on = pinned.includes(k); return (
              <li key={k}><div className="aa-m"><b>{t.t}</b><span>{t.d || `From ${t.basis}`}</span></div><span className="srcb ok">Indexed · {t.basis}</span><button className="btn btn-sm" disabled={on} onClick={() => onAdd({ key: k })}>{on ? 'Added' : 'Add'}</button></li>); })}</ul>
          ) : (
            <div className="aa-ask">
              <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Time from Phase 3 start to approval for each indication · Net revenue by product · Adverse event reports over time" />
              <div className="aa-chips">{['Time from Phase 3 start to approval', 'Net revenue by product', 'Adverse event reports over time', 'Prescription share vs Yutrepia'].map((x) => <button key={x} className="fu" onClick={() => setQ(x)}>{x}</button>)}</div>
              <div className="aa-how"><b>How this works</b><ol><li>Asset AI searches the passages already indexed for this asset. Nothing is re-crawled.</li><li>If the index can’t answer, it runs a public web search (FDA, EMA, ClinicalTrials.gov, SEC filings, company IR) and cites every source.</li><li>You review the chart and its sources before it’s pinned.</li></ol></div>
              <div className="nc-ft"><span className="sp"></span><button className="btn btn-sm btn-p" disabled={!q.trim()} onClick={ask}><Icon name="sparkles" size={14} />Build analysis</button></div>
            </div>
          )}
        </div>
      </div>
    </div>, document.body);
}

function OverviewAnalytics({ a, b }) {
  const key = 'pe.ovan.' + a.id;
  const [items, setItems] = oS(() => { try { const v = JSON.parse(localStorage.getItem(key)); if (v) return v; } catch (e) {} return OV_DEFAULT(a).map((k) => ({ key: k })); });
  const [open, setOpen] = oS(false);
  oE(() => { localStorage.setItem(key, JSON.stringify(items)); }, [items]);
  const evs = eventsFor(a.id, b);
  const pinned = items.filter((i) => i.key).map((i) => i.key);
  const rm = (i) => setItems(items.filter((_, j) => j !== i));
  return (
    <section className="ova">
      <div className="ova-h"><div><h3>Analytics</h3><p>Pinned for {a.name}. Add your own from indexed data, or ask Asset AI to build one.</p></div><div className="jx-acts"><button className="btn btn-sm" onClick={() => setItems(OV_DEFAULT(a).map((k) => ({ key: k })))}>Reset</button><button className="btn btn-sm btn-p" onClick={() => setOpen(true)}><Icon name="plus" size={14} />Add analytics</button></div></div>
      <div className="ch-grid">
        {items.map((it, i) => {
          if (it.custom) { const r = it.custom; return (
            <ChartCard key={r.id} title={r.t} span={['list', 'stack', 'hbar'].includes(r.chart) ? 2 : 1} desc={r.method === 'web' ? 'Asset AI · public web sources' : 'Asset AI · indexed data'} actions={<button className="icon-btn sm" aria-label="Remove" onClick={() => rm(i)}><Icon name="x" size={13} /></button>}>
              <AiChart r={r} />{r.note && <p className="aa-note"><Icon name="alert" size={12} />{r.note}</p>}
              <details className="ov-src"><summary><Icon name="sparkles" size={11} />{r.sources.length} source{r.sources.length === 1 ? '' : 's'}</summary>{r.sources.map((s) => <span key={s} className="mono">{s}</span>)}</details>
            </ChartCard>); }
          const t = OV_TEMPLATES[it.key]; if (!t || (t.need && !(PE_REC[a.id] && PE_REC[a.id][t.need]))) return null;
          return <ChartCard key={it.key} title={t.t} desc={t.d} span={t.span} actions={<button className="icon-btn sm" aria-label="Remove" onClick={() => rm(i)}><Icon name="x" size={13} /></button>}>{t.r(a, b, evs)}</ChartCard>;
        })}
        <button className="ova-add" onClick={() => setOpen(true)}><Icon name="plus" size={18} /><b>Add analytics</b><span>From indexed data, or ask Asset AI</span></button>
      </div>
      {open && <AddAnalytics a={a} b={b} pinned={pinned} onClose={() => setOpen(false)} onAdd={(x) => setItems((cur) => [...cur, x])} />}
    </section>
  );
}

Object.assign(window, { OverviewAnalytics });
