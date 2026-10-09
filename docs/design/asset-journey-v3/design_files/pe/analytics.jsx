const { useState: gS, useRef: gR2, useMemo: gM2 } = React;

/* ---------- chart primitives ---------- */
function ChartCard({ title, desc, span, children, actions }) {
  return <section className={'chc' + (span ? ' s' + span : '')}><div className="chc-h"><div><h4>{title}</h4>{desc && <p>{desc}</p>}</div>{actions}</div><div className="chc-b">{children}</div></section>;
}
function Legend({ items }) { return <div className="lgd">{items.map((i) => <span key={i.l}><i style={{ background: i.c }}></i>{i.l}{i.v != null && <em className="mono">{i.v}</em>}</span>)}</div>; }

function VBars({ data, h = 150, unit = '' }) {
  const ref = gR2(null), w = useWidth(ref), W = Math.max(w, 200);
  const mx = Math.max(1, ...data.map((d) => d.v)), bw = Math.min(46, (W - 10) / data.length - 8);
  const [hv, setHv] = gS(null);
  return (
    <div className="vb" ref={ref}>
      <svg width={W} height={h + 34}>
        {[0.5, 1].map((f) => <line key={f} x1={0} x2={W} y1={h - h * f + 8} y2={h - h * f + 8} stroke="#eef0f3" />)}
        {data.map((d, i) => { const x = 5 + i * ((W - 10) / data.length) + ((W - 10) / data.length - bw) / 2, bh = Math.max(2, (d.v / mx) * h); return (
          <g key={d.l} onMouseEnter={() => setHv(i)} onMouseLeave={() => setHv(null)}>
            <rect x={x} y={h - bh + 8} width={bw} height={bh} rx={4} fill={d.c || '#2347d9'} opacity={hv == null || hv === i ? 1 : 0.45} className="vb-r" style={{ animationDelay: `${i * 40}ms` }} />
            <text x={x + bw / 2} y={h - bh + 2} textAnchor="middle" className="vb-v">{d.v}{unit}</text>
            <text x={x + bw / 2} y={h + 24} textAnchor="middle" className="vb-l">{d.l}</text>
          </g>); })}
      </svg>
    </div>
  );
}
function StackBars({ cols, series, h = 160, every = 1 }) {
  const ref = gR2(null), w = useWidth(ref), W = Math.max(w, 260);
  const tot = cols.map((_, i) => series.reduce((s, x) => s + (x.vals[i] || 0), 0)), mx = Math.max(1, ...tot);
  const cw = (W - 30) / cols.length, bw = Math.max(3, Math.min(26, cw - 3));
  const [hv, setHv] = gS(null);
  return (
    <div className="vb" ref={ref}>
      <svg width={W} height={h + 26}>
        {[0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={26} x2={W} y1={h - h * f + 4} y2={h - h * f + 4} stroke="#eef0f3" /><text x={22} y={h - h * f + 8} textAnchor="end" className="vb-l">{Math.round(mx * f)}</text></g>)}
        {cols.map((c, i) => { let acc = 0; const x = 28 + i * cw + (cw - bw) / 2; return (
          <g key={c} onMouseEnter={() => setHv(i)} onMouseLeave={() => setHv(null)}>
            <rect x={28 + i * cw} y={0} width={cw} height={h + 4} fill={hv === i ? '#f2f4f7' : 'transparent'} />
            {series.map((s) => { const v = s.vals[i] || 0, bh = (v / mx) * h; acc += bh; return v ? <rect key={s.k} x={x} y={h - acc + 4} width={bw} height={Math.max(0, bh - 1)} rx={2} fill={s.c} className="vb-r" style={{ animationDelay: `${i * 18}ms` }} /> : null; })}
            {i % every === 0 && <text x={x + bw / 2} y={h + 20} textAnchor="middle" className="vb-l">{String(c).length === 4 ? `’${String(c).slice(2)}` : c}</text>}
          </g>); })}
      </svg>
      {hv != null && <div className="tip" style={{ left: 28 + hv * cw + cw / 2, top: h - (tot[hv] / mx) * h }}><b>{cols[hv]} · {tot[hv]}</b><span>{series.filter((s) => s.vals[hv]).map((s) => `${s.l} ${s.vals[hv]}`).join(' · ')}</span></div>}
      <Legend items={series.map((s) => ({ l: s.l, c: s.c, v: s.vals.reduce((a, b) => a + b, 0) }))} />
    </div>
  );
}
function HBars({ data, unit = '' }) {
  const mx = Math.max(1, ...data.map((d) => d.v));
  return <div className="hb">{data.map((d, i) => <div key={d.l} className="hb-r"><span className="hb-l">{d.l}</span><span className="hb-t"><i style={{ width: `${(d.v / mx) * 100}%`, background: d.c || '#2347d9', animationDelay: `${i * 50}ms` }}></i></span><span className="hb-v mono">{fmtNum(d.v)}{unit}</span></div>)}</div>;
}
function Donut({ data, size = 140, center, sub }) {
  const tot = data.reduce((s, d) => s + d.v, 0) || 1, r = size / 2 - 12, C = 2 * Math.PI * r;
  const [hv, setHv] = gS(null); let acc = 0;
  return (
    <div className="dn">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f2f4f7" strokeWidth="18" />
        {data.map((d, i) => { const len = (d.v / tot) * C, el = <circle key={d.l} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.c} strokeWidth={hv === i ? 22 : 18} strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`} onMouseEnter={() => setHv(i)} onMouseLeave={() => setHv(null)} className="dn-s" />; acc += len; return el; })}
        <text x="50%" y="47%" textAnchor="middle" className="dn-n">{hv != null ? data[hv].v : center != null ? center : tot}</text>
        <text x="50%" y="61%" textAnchor="middle" className="dn-l">{hv != null ? data[hv].l : sub || 'total'}</text>
      </svg>
      <Legend items={data.map((d) => ({ l: d.l, c: d.c, v: d.v }))} />
    </div>
  );
}
function Gantt({ rows, from, to }) {
  const now = yfrac(AJ.TODAY), p = (v) => ((v - from) / (to - from)) * 100;
  const ticks = []; const st = to - from > 36 ? 8 : to - from > 14 ? 4 : 2; for (let y = Math.ceil(from / st) * st; y <= to; y += st) ticks.push(y);
  return (
    <div className="gt">
      <div className="gt-ax"><span className="gt-sp"></span><div className="gt-tr">{ticks.map((y) => <span key={y} style={{ left: `${p(y)}%` }}>{y}</span>)}</div></div>
      {rows.map((r, i) => (
        <div key={r.l + i} className="gt-r">
          <span className="gt-l"><b>{r.l}</b>{r.sub && <span>{r.sub}</span>}</span>
          <div className="gt-tr">
            {ticks.map((y) => <i key={y} className="gt-g" style={{ left: `${p(y)}%` }}></i>)}
            <span className={'gt-b' + (r.dash ? ' dash' : '')} title={r.tip} style={{ left: `${p(r.s)}%`, width: `${Math.max(0.8, p(r.e) - p(r.s))}%`, background: r.dash ? 'transparent' : r.c, borderColor: r.c, animationDelay: `${i * 35}ms` }}>{r.tag && <em>{r.tag}</em>}</span>
            {r.pt && <span className="gt-pt" style={{ left: `${p(r.pt)}%`, background: r.c }}></span>}
          </div>
        </div>
      ))}
      <div className="gt-now" style={{ left: `calc(var(--gl) + (100% - var(--gl)) * ${p(now) / 100})` }}><em>Today</em></div>
    </div>
  );
}
function Heat({ rows, cols, cell }) {
  return (
    <div className="ht" style={{ gridTemplateColumns: `minmax(110px,160px) repeat(${cols.length}, minmax(64px,1fr))` }}>
      <span></span>{cols.map((c) => <span key={c} className="ht-c">{c}</span>)}
      {rows.map((r) => <React.Fragment key={r.l}><span className="ht-r"><b>{r.l}</b>{r.sub && <em>{r.sub}</em>}</span>{cols.map((c) => { const x = cell(r, c); return <span key={c} className={'ht-x ' + (x.k || '')} style={{ background: x.bg, color: x.fg }} title={x.t}>{x.label}</span>; })}</React.Fragment>)}
    </div>
  );
}
function Funnel({ steps }) {
  const mx = steps[0].v;
  return <div className="fn">{steps.map((s, i) => <div key={s.l} className="fn-r"><span className="fn-b" style={{ width: `${Math.max(8, (s.v / mx) * 100)}%`, background: s.c, animationDelay: `${i * 80}ms` }}><b className="mono">{fmtNum(s.v)}</b></span><span className="fn-l">{s.l}{i > 0 && <em>{Math.round((s.v / steps[i - 1].v) * 100)}%</em>}</span></div>)}</div>;
}
function Stat({ ic, l, v, sub, c }) { return <div className="stt"><span className="stt-l"><Icon name={ic} size={14} />{l}</span><span className="stt-v" style={c ? { color: c } : undefined}>{v}</span>{sub && <span className="stt-s">{sub}</span>}</div>; }

/* ---------- derived data ---------- */
const STAGES = ['Phase 1', 'Phase 2', 'Phase 3', 'Filed', 'Approved'];
const PHASE_C = { 'Phase 1': '#98a2b3', 'Phase 2': '#7a5af8', 'Phase 3': '#2347d9', 'Phase 4': '#0b7a6f' };
const STATUS_C = (s) => /recruit/i.test(s) ? '#2347d9' : /active/i.test(s) ? '#5873e8' : /complet/i.test(s) ? '#0b7a6f' : /terminat/i.test(s) ? '#b42318' : '#98a2b3';
const yrs = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function pipelineFor(a, evs) {
  const brs = AJ.BRANCHES[a.id];
  const lanes = brs ? brs.map((l) => ({ id: l.id, label: l.label, full: l.full, c: l.c, ended: l.ended })) : [...a.indications, ...a.investigational].map((x, i) => ({ id: x, label: x, full: x, c: ['#2347d9', '#0b7a6f', '#6941c6', '#e0620f'][i % 4] }));
  return lanes.map((l) => {
    const le = evs.filter((e) => (brs ? (AJ.LANE_OF[e.id] || brs[0].id) === l.id : (e.ind || []).some((x) => x.includes(l.id)) || a.indications.includes(l.id)));
    let stage = 0;
    if (le.some((e) => ['approval', 'label_expansion', 'new_formulation'].includes(e.type)) || (!brs && a.indications.includes(l.id))) stage = 4;
    else if (le.some((e) => e.type === 'submission_accepted' || e.type === 'regulatory_decision_expected')) stage = 3;
    else { const ph = le.map((e) => e.phase).filter(Boolean).map((p) => STAGES.indexOf(p)).filter((i) => i >= 0); stage = ph.length ? Math.max(...ph) : 2; }
    const next = le.filter((e) => e.is_milestone).sort((x, z) => x.date.localeCompare(z.date))[0];
    const since = le.filter((e) => !e.is_milestone).sort((x, z) => x.date.localeCompare(z.date))[0];
    return { ...l, stage, n: le.length, next, since };
  });
}

function PipelineMatrix({ rows }) {
  return (
    <div className="pm">
      <div className="pm-h"><span></span>{STAGES.map((s) => <span key={s}>{s}</span>)}<span>Next</span></div>
      {rows.map((r, i) => (
        <div key={r.id} className={'pm-r' + (r.ended ? ' x' : '')}>
          <span className="pm-l"><i style={{ background: r.c }}></i><b>{r.label}</b><em>{r.full}</em></span>
          <span className="pm-t" style={{ gridColumn: `span ${STAGES.length}` }}>
            {STAGES.map((s) => <i key={s} className="pm-g"></i>)}
            <span className="pm-b" style={{ width: `${((r.stage + 0.55) / STAGES.length) * 100}%`, background: r.ended ? undefined : r.c, animationDelay: `${i * 80}ms` }}><em>{r.ended ? `${STAGES[r.stage]} · terminated` : STAGES[r.stage]}</em></span>
          </span>
          <span className="pm-n">{r.next ? <><b>{r.next.title.replace(/^(Phase \d readout expected|FDA decision expected \(PDUFA date\)): /, '')}</b><em>{relFuture(r.next.date)}</em></> : <em>{r.since ? `since ${r.since.date.slice(0, 4)}` : '—'}</em>}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Analytics tab ---------- */
function AnalyticsTab({ a, b }) {
  const evs = eventsFor(a.id, b);
  const rec = window.PE_REC && PE_REC[a.id];
  const pipe = pipelineFor(a, evs);
  const yr0 = Math.min(...evs.map((e) => +e.date.slice(0, 4)), 2015), yr1 = Math.max(...evs.map((e) => +e.date.slice(0, 4)), 2027);
  const ys = yrs(yr0, yr1);
  const catSeries = Object.entries(AJ.CAT).map(([k, m]) => ({ k, l: m.label, c: m.c, vals: ys.map((y) => evs.filter((e) => e.category === k && +e.date.slice(0, 4) === y).length) }));
  const next = evs.filter((e) => e.is_milestone).sort((x, z) => x.date.localeCompare(z.date))[0];
  const trials = rec ? rec.clinical : [];
  const active = trials.filter((t) => /recruit|active/i.test(t.status));
  const pats = rec ? rec.patents.filter((p) => p.expiry > AJ.TODAY && !/invalid/i.test(p.status)).sort((x, z) => x.expiry.localeCompare(z.expiry)) : [];
  const comps = PE.ASSETS.filter((c) => c.competitorOf.includes(a.id));
  const inds = [...a.indications, ...a.investigational];
  const recs = a.id === 'treprostinil' ? b.records : [];
  const collK = Object.keys(AJ.COLL);
  const ry = yrs(2002, 2027);
  const sig = ['High', 'Medium', 'Low'].map((s, i) => ({ l: s, v: evs.filter((e) => e.significance === s).length, c: ['#b42318', '#dc8a0e', '#98a2b3'][i] }));
  return (
    <div className="an">
      <div className="stts">
        <Stat ic="landmark" l="Approved indications" v={pipe.filter((p) => p.stage === 4).length} sub={a.regions.join(', ') || '—'} c="#0b7a6f" />
        <Stat ic="flask" l="In development" v={pipe.filter((p) => p.stage < 4 && !p.ended).length} sub={pipe.filter((p) => p.stage < 4 && !p.ended).map((p) => p.label).join(', ') || '—'} />
        <Stat ic="activity" l="Active trials" v={rec ? active.length : a.trials} sub={rec ? `${active.filter((t) => t.phase === 'Phase 3').length} in Phase 3 · ${fmtNum(active.reduce((s, t) => s + t.n, 0))} patients` : 'ClinicalTrials.gov'} />
        <Stat ic="clock" l="Next catalyst" v={next ? relFuture(next.date).replace('in ', '') : '—'} sub={next ? next.title : 'None scheduled'} c="#2347d9" />
        <Stat ic="stamp" l="Patent runway" v={pats[0] ? `${((new Date(pats[0].expiry) - new Date(AJ.TODAY)) / 3.156e10).toFixed(1)} yrs` : '—'} sub={pats[0] ? `${pats[0].num} · ${pats[0].prod}` : 'No curated patents'} c="#6941c6" />
        <Stat ic="database" l="Evidence records" v={fmtNum(a.id === 'treprostinil' ? b.records.length : a.records)} sub={`${evs.length} journey events`} />
      </div>
      <div className="ch-grid">
        <ChartCard title="Development pipeline" desc="Furthest stage reached per indication, derived from trials, filings and approvals on the journey" span={2}><PipelineMatrix rows={pipe} /></ChartCard>
        <ChartCard title="Journey activity by year" desc="Events per year by category; hover a year for the breakdown" span={2}><StackBars cols={ys} series={catSeries} every={ys.length > 18 ? 2 : 1} /></ChartCard>
        {rec && <ChartCard title="Clinical trial timeline" desc="Start to primary completion, coloured by phase" span={2}><Gantt from={2004} to={2028} rows={[...trials].sort((x, z) => x.start.localeCompare(z.start)).map((t) => ({ l: t.name !== '—' ? t.name : t.nct, sub: `${t.ind} · n=${t.n}`, s: yfrac(t.start + '-01'), e: yfrac(t.pcd + '-28'), c: PHASE_C[t.phase], tag: t.phase.replace('Phase ', 'P'), dash: /terminat|unknown/i.test(t.status), tip: `${t.title} · ${t.status}` }))} /></ChartCard>}
        {rec && <ChartCard title="Trials by phase"><VBars data={['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map((p) => ({ l: p.replace('Phase ', 'P'), v: trials.filter((t) => t.phase === p).length, c: PHASE_C[p] }))} /></ChartCard>}
        {rec && <ChartCard title="Enrolment by indication" desc="Patients across all studies"><HBars data={Object.entries(trials.reduce((m, t) => ((m[t.ind] = (m[t.ind] || 0) + t.n), m), {})).sort((x, z) => z[1] - x[1]).map(([l, v], i) => ({ l, v, c: ['#2347d9', '#0b7a6f', '#6941c6', '#e0620f', '#5873e8', '#98a2b3', '#b54708'][i % 7] }))} /></ChartCard>}
        {recs.length > 0 && <ChartCard title="Evidence collected over time" desc="Stored records by the year they describe" span={2}><StackBars cols={ry} every={2} series={collK.map((k) => ({ k, l: k.replace('_records', ''), c: AJ.COLL[k].c, vals: ry.map((y) => recs.filter((r) => r.coll === k && Math.floor(r.y) === y).length) })).filter((s) => s.vals.some(Boolean))} /></ChartCard>}
        {recs.length > 0 && <ChartCard title="Source mix"><Donut data={collK.map((k) => ({ l: k.replace('_records', ''), v: recs.filter((r) => r.coll === k).length, c: AJ.COLL[k].c })).filter((d) => d.v)} sub="records" /></ChartCard>}
        {a.id === 'treprostinil' && <ChartCard title="AI triage funnel" desc="Unstructured records to journey events"><Funnel steps={[{ l: 'Unstructured records', v: 186, c: '#98a2b3' }, { l: 'Relevant to the asset', v: 74, c: '#5873e8' }, { l: 'Ingested in full', v: 41, c: '#2347d9' }, { l: 'Event candidates', v: 21, c: '#6941c6' }, { l: 'Journey events', v: evs.filter((e) => e.via === 'ai_events').length, c: '#0b7a6f' }]} /></ChartCard>}
        {pats.length > 0 && <ChartCard title="Patent runway" desc="Grant to expiry; the dashed line is today" span={2}><Gantt from={1992} to={2044} rows={rec.patents.map((p) => ({ l: p.num, sub: p.prod, s: yfrac(p.granted), e: yfrac(p.expiry), c: /invalid/i.test(p.status) ? '#b42318' : p.expiry < AJ.TODAY ? '#98a2b3' : '#6941c6', dash: /invalid/i.test(p.status), tag: /invalid/i.test(p.status) ? 'invalidated' : p.expiry.slice(0, 4), tip: `${p.title} · ${p.status}` }))} /></ChartCard>}
        {comps.length > 0 && inds.length > 0 && <ChartCard title="Competitive landscape" desc="Indication coverage of ranked competitors" span={2}><Heat cols={inds} rows={[{ l: a.name, sub: 'this asset', ...a, me: true }, ...comps.map((c) => ({ l: c.name, sub: c.company, ...c }))]} cell={(r, c) => r.indications.includes(c) ? { label: 'Approved', bg: '#e6f4f2', fg: '#0b7a6f', t: `${r.l}: approved in ${c}` } : r.investigational.includes(c) ? { label: 'In trials', bg: '#fffaeb', fg: '#b54708', t: `${r.l}: investigational in ${c}` } : { label: '—', bg: '#f9fafb', fg: '#98a2b3', t: 'Not pursued' }} /></ChartCard>}
        <ChartCard title="Significance mix"><Donut data={sig} sub="events" /></ChartCard>
      </div>
    </div>
  );
}

/* ---------- per-tab insights above the records tables ---------- */
function TabInsights({ a, tab, rows, evs }) {
  if (!rows || !rows.length) return null;
  const count = (k) => Object.entries(rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {})).sort((x, z) => z[1] - x[1]);
  const pal = ['#2347d9', '#0b7a6f', '#e0620f', '#6941c6', '#98a2b3', '#5873e8', '#b42318', '#b54708'];
  const byYear = (get, from, to) => { const ys = yrs(from, to); return { ys, vals: ys.map((y) => rows.filter((r) => +String(get(r)).slice(0, 4) === y).length) }; };
  let cards = null;
  if (tab === 'clinical' && rows[0].nct) {
    const st = byYear((r) => r.start, 2005, 2026);
    cards = [<ChartCard key="a" title="Phase"><VBars h={110} data={['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map((p) => ({ l: p.replace('Phase ', 'P'), v: rows.filter((t) => t.phase === p).length, c: PHASE_C[p] }))} /></ChartCard>,
      <ChartCard key="b" title="Status"><Donut size={120} data={count('status').map(([l, v]) => ({ l, v, c: STATUS_C(l) }))} sub="trials" /></ChartCard>,
      <ChartCard key="c" title="Trial starts by year" span={2}><StackBars h={110} cols={st.ys} every={3} series={[{ k: 'co', l: 'Company-sponsored', c: '#2347d9', vals: st.ys.map((y) => rows.filter((r) => r.co && +r.start.slice(0, 4) === y).length) }, { k: 'inv', l: 'Investigator / academic', c: '#98a2b3', vals: st.ys.map((y) => rows.filter((r) => !r.co && +r.start.slice(0, 4) === y).length) }]} /></ChartCard>];
  } else if (tab === 'regulatory' && rows[0].app) {
    const ys = yrs(2002, 2027);
    cards = [<ChartCard key="a" title="Regulatory activity by year" span={2}><StackBars h={110} cols={ys} every={3} series={['US', 'EU'].map((r, i) => ({ k: r, l: r === 'US' ? 'FDA (US)' : 'EMA / EC (EU)', c: pal[i], vals: ys.map((y) => rows.filter((x) => x.region === r && +x.date.slice(0, 4) === y).length) }))} /></ChartCard>,
      <ChartCard key="b" title="Outcome"><Donut size={120} data={count('status').map(([l, v], i) => ({ l, v, c: /approv|authoris|positive/i.test(l) ? '#0b7a6f' : /review|expected/i.test(l) ? '#2347d9' : /complete response/i.test(l) ? '#b42318' : pal[(i + 3) % 8] }))} sub="records" /></ChartCard>,
      <ChartCard key="c" title="By product"><HBars data={count('product').slice(0, 6).map(([l, v], i) => ({ l, v, c: pal[i] }))} /></ChartCard>];
  } else if (tab === 'publications' && rows[0].pmid) {
    const pr = AJ.RECORDS.filter((r) => r.coll === 'publication_records'), ys = yrs(2002, 2026);
    cards = [<ChartCard key="a" title="Publications per year" desc="All 210 PubMed records" span={2}><StackBars h={110} cols={ys} every={3} series={[{ k: 'p', l: 'Publications', c: '#475467', vals: ys.map((y) => pr.filter((r) => Math.floor(r.y) === y).length) }]} /></ChartCard>,
      <ChartCard key="b" title="Study design"><Donut size={120} data={count('type').map(([l, v], i) => ({ l, v, c: pal[i] }))} sub="curated" /></ChartCard>,
      <ChartCard key="c" title="Journals"><HBars data={count('journal').slice(0, 5).map(([l, v], i) => ({ l, v, c: pal[i] }))} /></ChartCard>];
  } else if (tab === 'conferences' && rows[0].congress) {
    const cg = ['ATS', 'ERS', 'CHEST'], ys = [...new Set(rows.map((r) => +r.date.slice(0, 4)))].sort();
    cards = [<ChartCard key="a" title="Abstracts by congress and year" span={3}><Heat cols={ys.map(String)} rows={cg.map((c) => ({ l: c }))} cell={(r, y) => { const n = rows.filter((x) => x.congress.startsWith(r.l) && x.date.startsWith(y)).length; return { label: n || '', bg: n ? `rgba(122,90,248,${0.15 + n * 0.3})` : '#f9fafb', fg: n > 1 ? '#fff' : '#6941c6', t: `${r.l} ${y}: ${n}` }; }} /></ChartCard>,
      <ChartCard key="b" title="Format"><Donut size={120} data={count('type').map(([l, v]) => ({ l, v, c: l === 'Late-breaking' ? '#b42318' : l === 'Oral' ? '#2347d9' : '#98a2b3' }))} sub="abstracts" /></ChartCard>];
  } else if (tab === 'company-ir' && rows[0].cat) {
    const ys = yrs(2009, 2026), cats = count('cat').map(([l]) => l);
    cards = [<ChartCard key="a" title="Press releases by year and topic" span={3}><StackBars h={110} cols={ys} every={2} series={cats.map((c, i) => ({ k: c, l: c, c: pal[i], vals: ys.map((y) => rows.filter((r) => r.cat === c && +r.date.slice(0, 4) === y).length) }))} /></ChartCard>,
      <ChartCard key="b" title="Topics"><Donut size={120} data={count('cat').map(([l, v], i) => ({ l, v, c: pal[i] }))} sub="releases" /></ChartCard>];
  } else if (tab === 'patents' && rows[0].num) {
    cards = [<ChartCard key="a" title="Patent terms" desc="Grant to expiry · dashed line is today" span={3}><Gantt from={1992} to={2044} rows={[...rows].sort((x, z) => x.expiry.localeCompare(z.expiry)).map((p) => ({ l: p.num, sub: p.prod, s: yfrac(p.granted), e: yfrac(p.expiry), c: /invalid/i.test(p.status) ? '#b42318' : p.expiry < AJ.TODAY ? '#98a2b3' : '#6941c6', dash: /invalid/i.test(p.status), tag: p.expiry.slice(0, 4) }))} /></ChartCard>,
      <ChartCard key="b" title="Status"><Donut size={120} data={count('status').map(([l, v]) => ({ l, v, c: /expired/i.test(l) ? '#98a2b3' : /invalid/i.test(l) ? '#b42318' : /litig|assert/i.test(l) ? '#dc8a0e' : '#6941c6' }))} sub="patents" /></ChartCard>];
  } else if (tab === 'evidence' && rows[0].verdict) {
    cards = [<ChartCard key="a" title="AI triage" desc="186 unstructured records screened" span={2}><Funnel steps={[{ l: 'Screened', v: 186, c: '#98a2b3' }, { l: 'Relevant', v: 74, c: '#5873e8' }, { l: 'Ingested in full', v: 41, c: '#2347d9' }, { l: 'Became journey events', v: evs.filter((e) => e.via === 'ai_events').length, c: '#0b7a6f' }]} /></ChartCard>,
      <ChartCard key="b" title="Decisions" desc="In this sample"><Donut size={120} data={count('verdict').map(([l, v]) => ({ l, v, c: l === 'Ingest' ? '#0b7a6f' : l === 'Headline' ? '#dc8a0e' : '#98a2b3' }))} sub="records" /></ChartCard>,
      <ChartCard key="c" title="Top sources"><HBars data={count('src').slice(0, 5).map(([l, v], i) => ({ l, v, c: pal[i] }))} /></ChartCard>];
  } else if (tab === 'documents' && rows[0].pages) {
    cards = [<ChartCard key="a" title="Document types"><Donut size={120} data={count('type').map(([l, v], i) => ({ l, v, c: pal[i] }))} sub="documents" /></ChartCard>,
      <ChartCard key="b" title="Pages by document" span={3}><HBars data={[...rows].sort((x, z) => z.pages - x.pages).slice(0, 6).map((r, i) => ({ l: r.title, v: r.pages, c: pal[i % 8] }))} unit=" pp" /></ChartCard>];
  } else {
    const ys = yrs(Math.min(...rows.map((r) => +r.date.slice(0, 4))), Math.max(...rows.map((r) => +r.date.slice(0, 4))));
    cards = [<ChartCard key="a" title="Records by year" span={3}><StackBars h={110} cols={ys} series={[...new Set(rows.map((r) => r.coll))].map((k) => ({ k, l: k, c: AJ.COLL[k].c, vals: ys.map((y) => rows.filter((r) => r.coll === k && +r.date.slice(0, 4) === y).length) }))} /></ChartCard>,
      <ChartCard key="b" title="Collections"><Donut size={120} data={count('coll').map(([l, v]) => ({ l, v, c: AJ.COLL[l].c }))} sub="records" /></ChartCard>];
  }
  return <div className="ch-grid ins">{cards}</div>;
}

Object.assign(window, { pipelineFor, PipelineMatrix, PHASE_C, STATUS_C, AnalyticsTab, TabInsights, ChartCard, VBars, StackBars, HBars, Donut, Gantt, Heat, Funnel, Stat });
