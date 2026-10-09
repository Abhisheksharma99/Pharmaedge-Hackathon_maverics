const { useState: hS, useRef: hR, useMemo: hM } = React;

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
const PRIMARY = () => PE.ASSETS.filter((a) => a.kind === 'primary');

function DashHero({ b, evs }) {
  const { go } = useNav();
  const [q, setQ] = hS('');
  const new30 = evs.filter((e) => !e.is_milestone && daysFrom(e.date) >= -30 && daysFrom(e.date) <= 0);
  const high30 = new30.filter((e) => e.significance === 'High').length;
  const up6 = evs.filter((e) => e.is_milestone && daysFrom(e.date) <= 183).length;
  return (
    <section className="hero">
      <div className="hero-t">
        <p className="hero-d">{new Date(AJ.TODAY + 'T09:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        <h1>{greeting()}, {PE.USER.first}</h1>
        <p className="hero-s"><b>{new30.length} new event{new30.length === 1 ? '' : 's'}</b> in the last 30 days{high30 > 0 && ` (${high30} high-significance)`} · <b>{up6} milestone{up6 === 1 ? '' : 's'}</b> in the next 6 months{b.phase !== 'done' && <> · Treprostinil journey <b>{Math.round(b.progress * 100)}% built</b></>}</p>
      </div>
      <form className="hero-ask" onSubmit={(e) => { e.preventDefault(); go({ page: 'chat', ask: q || undefined }); }}>
        <Icon name="sparkles" size={16} className="hero-ask-ic" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your assets, competitors and evidence…" aria-label="Ask Asset AI" />
        <button type="submit" className="btn btn-sm btn-p" aria-label="Ask"><Icon name="send" size={14} /></button>
      </form>
    </section>
  );
}

function DashKpis({ b, evs }) {
  const prim = PRIMARY(), comp = PE.ASSETS.length - prim.length;
  const ev90 = evs.filter((e) => !e.is_milestone && daysFrom(e.date) >= -90 && daysFrom(e.date) <= 0).length;
  const up12 = evs.filter((e) => e.is_milestone && daysFrom(e.date) <= 365).length;
  const recs = PE.ASSETS.reduce((s, a) => s + (a.id === 'treprostinil' ? b.records.length : a.records), 0);
  const items = [
    ['pill', 'Tracked assets', prim.length, `${comp} competitors monitored`],
    ['route', 'New events', ev90, 'Last 90 days, across all assets'],
    ['calendar', 'Upcoming milestones', up12, 'Next 12 months'],
    ['database', 'Records collected', fmtNum(recs), 'FDA, EMA, trials, PubMed, news'],
    ['activity', 'Crawls running', b.phase === 'done' ? 0 : 1, b.phase === 'done' ? 'Next scheduled refresh 06:00' : `Treprostinil · ${Math.round(b.progress * 100)}%`],
  ];
  return <KpiStrip items={items} />;
}

function PortfolioTimeline({ b, onOpen }) {
  const { go } = useNav();
  const [range, setRange] = hS('3y');
  const [comps, setComps] = hS(false);
  const [hv, setHv] = hS(null);
  const ref = hR(null);
  const w = useWidth(ref);
  const T = yfrac(AJ.TODAY);
  const [y0, y1] = range === '1y' ? [T - 1, T + 1.15] : range === '3y' ? [T - 3, T + 1.6] : [2000, 2029];
  const W = Math.max(w, 300), R = 14, rowH = 46;
  const x = (y) => ((y - y0) / (y1 - y0)) * (W - R);
  const rows = PE.ASSETS.filter((a) => a.kind === 'primary' || comps);
  const H = rows.length * rowH + 24;
  const ticks = [];
  if (range === '1y') { for (let y = Math.ceil(y0 * 4) / 4; y <= y1; y += 0.25) ticks.push({ v: y, l: `${['Jan', 'Apr', 'Jul', 'Oct'][Math.round((y % 1) * 4) % 4]} ’${String(Math.floor(y + 1e-6)).slice(2)}` }); }
  else { const st = range === '3y' ? 1 : 4; for (let y = Math.ceil(y0 / st) * st; y <= y1; y += st) ticks.push({ v: y, l: String(y) }); }
  const tx = x(T);
  const pct = Math.round(b.progress * 100);
  const hvE = hv && allEvents(b).find((e) => e.asset + e.id === hv);
  return (
    <Panel title="Portfolio timeline" desc="Every journey on one axis. Hollow markers are expected milestones; select one to see its evidence."
      actions={<div className="jx-acts"><Switch on={comps} onChange={setComps} label="Show competitors" /><Seg label="Range" value={range} onChange={setRange} options={[{ value: '1y', label: '±1 year' }, { value: '3y', label: '3 years' }, { value: 'all', label: 'All time' }]} /></div>}>
      <div className="pt">
        <div className="pt-labels">
          {rows.map((a) => {
            const building = a.id === 'treprostinil' && b.phase !== 'done';
            return (
              <button key={a.id} className="pt-lab" style={{ height: rowH }} onClick={() => go({ page: 'asset', id: a.id, tab: 'overview' })}>
                <AssetTile a={a} size={26} /><span className="pt-n"><b>{a.name}</b><span>{building ? <span className="pt-b"><i></i>{`Building · ${pct}%`}</span> : a.kind === 'competitor' ? `vs ${a.competitorOf.map((c) => PE.byId[c].name).join(', ')}` : a.company}</span></span>
              </button>
            );
          })}
        </div>
        <div className="pt-plot" ref={ref}>
          <svg width={W} height={H} className="pt-svg">
            <defs><pattern id="pt-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#eef0f3" strokeWidth="2" /></pattern></defs>
            {rows.map((a, i) => <rect key={a.id} x={0} y={i * rowH} width={W - R} height={rowH} fill={i % 2 ? '#fff' : '#fafbfc'} />)}
            <rect x={tx} y={0} width={Math.max(0, W - R - tx)} height={rows.length * rowH} fill="url(#pt-hatch)" />
            {ticks.map((t) => <line key={t.v} x1={x(t.v)} x2={x(t.v)} y1={0} y2={rows.length * rowH} stroke="#eef0f3" />)}
            {rows.map((a, i) => {
              const evs = eventsFor(a.id, b).filter((e) => { const v = yfrac(e.date); return v >= y0 && v <= y1; });
              const cy = i * rowH + rowH / 2;
              return (
                <g key={a.id}>
                  <line x1={0} x2={W - R} y1={cy} y2={cy} stroke="#e4e7ec" strokeDasharray={a.kind === 'competitor' ? '2 3' : undefined} />
                  {evs.map((e) => {
                    const c = AJ.CAT[e.category].c, r = e.significance === 'High' ? 6.5 : e.significance === 'Medium' ? 5 : 3.6, k = e.asset + e.id;
                    return (
                      <g key={k} className="ft-ev" onMouseEnter={() => setHv(k)} onMouseLeave={() => setHv(null)} onClick={() => onOpen(e)}>
                        <circle className="ft-dot" cx={x(yfrac(e.date))} cy={cy} r={hv === k ? r + 2 : r} fill={e.is_milestone ? '#fff' : c} stroke={e.is_milestone ? c : '#fff'} strokeWidth={e.is_milestone ? 1.8 : 1.5} strokeDasharray={e.is_milestone ? '2.4 1.8' : undefined} />
                        <circle cx={x(yfrac(e.date))} cy={cy} r={11} fill="transparent" />
                      </g>
                    );
                  })}
                </g>
              );
            })}
            <line x1={tx} x2={tx} y1={0} y2={rows.length * rowH + 4} stroke="#101828" strokeDasharray="3 3" />
            {ticks.filter((t) => Math.abs(x(t.v) - tx) > 34).map((t) => <text key={t.v} x={x(t.v)} y={H - 6} textAnchor="middle" className="ft-yr">{t.l}</text>)}
            <text x={tx} y={H - 6} textAnchor="middle" className="ft-today">Today</text>
          </svg>
          {hvE && <div className="tip" style={{ left: x(yfrac(hvE.date)), top: rows.findIndex((a) => a.id === hvE.asset) * rowH + rowH / 2 - 8 }}><b>{hvE.title}</b><span>{PE.byId[hvE.asset].name} · {hvE.is_milestone ? `expected ${fmtMonth(hvE.date)}` : fmtDate(hvE.date)}</span></div>}
        </div>
      </div>
      <div className="pt-leg">{Object.entries(AJ.CAT).map(([k, m]) => <span key={k}><i style={{ background: m.c }}></i>{m.label}</span>)}<span><i className="hol"></i>Expected</span></div>
    </Panel>
  );
}

function WhatChanged({ evs, onOpen }) {
  const { go } = useNav();
  const recent = evs.filter((e) => !e.is_milestone && daysFrom(e.date) <= 0 && daysFrom(e.date) >= -90 && e.significance !== 'Low').sort((a, z) => z.date.localeCompare(a.date));
  const groups = [['Last 7 days', 0, -7], ['Last 30 days', -8, -30], ['Last 90 days', -31, -90]].map(([l, a, z]) => [l, recent.filter((e) => daysFrom(e.date) <= a && daysFrom(e.date) >= z)]).filter(([, xs]) => xs.length);
  return (
    <Panel title="What changed" desc="High- and medium-significance events across your assets and their competitors" bodyClass="wc">
      {groups.length === 0 && <div className="empty"><p className="t">Quiet quarter</p><p>No new key events in the last 90 days.</p></div>}
      {groups.map(([l, xs]) => (
        <div key={l} className="wc-g"><p className="wc-h">{l}</p>
          {xs.map((e) => {
            const a = PE.byId[e.asset];
            return (
              <button key={e.asset + e.id} className="wc-i" onClick={() => onOpen(e)}>
                <CatIcon cat={e.category} size={30} />
                <span className="wc-m"><span className="wc-t">{e.title}</span><span className="wc-s"><span className="a-chip" onClick={(ev) => { ev.stopPropagation(); go({ page: 'asset', id: a.id, tab: 'overview' }); }}><AssetTile a={a} size={16} />{a.name}</span>{a.kind === 'competitor' && <span className="tag">Competitor</span>}<span className="mono">{fmtDate(e.date)}</span>{e.via === 'ai_events' && <span className="via via-ai_events"><Icon name="sparkles" size={11} />{`${e.sources.length} source${e.sources.length === 1 ? '' : 's'}`}</span>}</span></span>
                <Sig v={e.significance} />
              </button>
            );
          })}
        </div>
      ))}
    </Panel>
  );
}

function NextMilestones({ evs, onOpen }) {
  const up = evs.filter((e) => e.is_milestone).sort((a, z) => a.date.localeCompare(z.date)).slice(0, 6);
  return (
    <Panel title="Next milestones" desc="Readouts, regulatory decisions and patent expiries" bodyClass="nm">
      {up.map((e) => {
        const d = new Date(e.date + 'T00:00:00'), days = daysFrom(e.date), a = PE.byId[e.asset];
        return (
          <button key={e.asset + e.id} className="nm-i" onClick={() => onOpen(e)}>
            <span className="nm-d"><span>{d.toLocaleDateString('en-US', { month: 'short' })}</span><b>{d.getFullYear()}</b></span>
            <span className="nm-m"><span className="nm-t">{e.title}</span><span className="nm-s"><AssetTile a={a} size={16} />{a.name}<span className="nm-cd">{relFuture(e.date)}</span></span>
              <span className="nm-bar"><i style={{ width: `${Math.max(4, 100 - (days / 548) * 100)}%`, background: AJ.CAT[e.category].c }}></i></span></span>
          </button>
        );
      })}
    </Panel>
  );
}

function CrawlsCard({ b }) {
  const { go } = useNav();
  const done = b.phase === 'done';
  const last = PE.JOBS.filter((j) => !j.live).slice(0, 3);
  return (
    <Panel title="Crawls" desc={done ? 'Nothing running right now' : 'Data collection running now'} bodyClass="cr"
      actions={<button className="btn btn-sm btn-ghost" onClick={() => go({ page: 'jobs' })}>All jobs</button>}>
      <button className={'cr-live' + (done ? ' done' : '')} onClick={() => go({ page: 'asset', id: 'treprostinil', tab: 'overview' })}>
        <span className="cr-h"><AssetTile a={PE.byId.treprostinil} size={26} /><span className="cr-n"><b>Treprostinil · onboarding</b><span>{done ? `Finished · ${b.events.length} events from ${fmtNum(b.records.length)} records` : b.phase === 'planning' ? 'Planning 17 steps' : `Step ${b.current.i + 1} of 17 · ${b.current.short}`}</span></span><span className="mono cr-p">{Math.round(b.progress * 100)}%</span></span>
        <span className="cr-bar">{b.steps.map((s) => <i key={s.name} className={s.status} style={{ flexGrow: s.dur, '--p': `${s.p * 100}%` }}></i>)}</span>
        <span className="cr-go">{done ? 'Explore the journey' : 'Watch the live build'}<Icon name="arrowR" size={13} /></span>
      </button>
      {last.map((j) => (
        <button key={j.id} className="cr-i" onClick={() => go({ page: 'job', id: j.id })}>
          <JobBadge status={j.status} /><span className="cr-a">{PE.byId[j.asset].name}<span> · {j.type}</span></span><span className="mono">{fmtDur(j.dur)}</span>
        </button>
      ))}
    </Panel>
  );
}

const JOB_ST = { queued: ['Queued', ''], running: ['Running', 'run'], completed: ['Completed', 'ok'], completed_with_errors: ['Completed with errors', 'warn'], failed: ['Failed', 'bad'], cancelled: ['Cancelled', ''] };
const JobBadge = ({ status }) => <span className={'jb jb-' + JOB_ST[status][1]}>{JOB_ST[status][0]}</span>;

function Spark({ evs }) {
  const ys = []; for (let y = 2015; y <= 2027; y++) ys.push(y);
  const counts = ys.map((y) => evs.filter((e) => +e.date.slice(0, 4) === y).length);
  const mx = Math.max(3, ...counts);
  return <svg width="100%" height="30" viewBox={`0 0 ${ys.length * 10} 30`} preserveAspectRatio="none" className="spark">{ys.map((y, i) => <rect key={y} x={i * 10 + 1.5} y={30 - Math.max(1.5, (counts[i] / mx) * 28)} width={7} height={Math.max(1.5, (counts[i] / mx) * 28)} rx={1.5} fill={y > 2026 ? '#fff' : y === 2026 ? '#2347d9' : '#c7d1f4'} stroke={y > 2026 ? '#98a2b3' : 'none'} strokeDasharray={y > 2026 ? '2 1.5' : undefined} strokeWidth={0.8} />)}</svg>;
}

function TrackedAssets({ b }) {
  const { go } = useNav();
  return (
    <section className="ta">
      <div className="sec-h"><div><h3>Tracked assets</h3><p>{PRIMARY().length} primary · {PE.ASSETS.length - PRIMARY().length} competitors</p></div><button className="btn btn-sm" onClick={() => go({ page: 'assets' })}>Asset Search<Icon name="arrowR" size={13} /></button></div>
      <div className="ta-grid">
        {PRIMARY().map((a, i) => {
          const evs = eventsFor(a.id, b), building = a.id === 'treprostinil' && b.phase !== 'done';
          const past = evs.filter((e) => !e.is_milestone).sort((x, z) => z.date.localeCompare(x.date));
          const next = evs.filter((e) => e.is_milestone).sort((x, z) => x.date.localeCompare(z.date))[0];
          const comps = PE.ASSETS.filter((c) => c.competitorOf.includes(a.id));
          return (
            <button key={a.id} className="ta-c" style={{ animationDelay: `${i * 70}ms` }} onClick={() => go({ page: 'asset', id: a.id, tab: 'overview' })}>
              <span className="ta-h"><AssetTile a={a} size={36} /><span className="ta-n"><b>{a.name}</b><span>{a.brand ? `${a.brand.split(' · ')[0]} · ` : ''}{a.company}</span></span>
                {building ? <span className="spill onb"><i></i>{`${Math.round(b.progress * 100)}%`}</span> : <span className="spill ok"><i></i>{a.regions.join(', ')}</span>}</span>
              <span className="ta-chips">{a.indications.map((x) => <span key={x} className="tag">{x}</span>)}{a.investigational.map((x) => <span key={x} className="tag dash">{x}</span>)}</span>
              <Spark evs={evs} />
              <span className="ta-l"><span className="ta-k">Latest</span><span className="trunc">{past[0] ? past[0].title : building ? 'Collecting records…' : '—'}</span></span>
              <span className="ta-f"><span><b>{evs.length}</b> events</span><span><b>{a.trials}</b> trials</span><span><b>{comps.length}</b> competitors</span>{next && <span className="ta-next"><Icon name="clock" size={11} />{relFuture(next.date)}</span>}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CompetitiveSignals({ onOpen }) {
  const comp = PE.EV.filter((e) => PE.byId[e.asset].kind === 'competitor').sort((a, z) => z.date.localeCompare(a.date));
  return (
    <Panel title="Competitive signals" desc="Moves by competitors of your assets" bodyClass="wc">
      {comp.map((e) => {
        const a = PE.byId[e.asset];
        return (
          <button key={e.id} className="wc-i" onClick={() => onOpen(e)}>
            <AssetTile a={a} size={30} />
            <span className="wc-m"><span className="wc-t">{e.title}</span><span className="wc-s"><b>{a.name}</b><span>vs {a.competitorOf.map((c) => PE.byId[c].name).join(', ')}</span><span className="mono">{e.is_milestone ? `expected ${fmtMonth(e.date)}` : fmtDate(e.date)}</span></span></span>
            <Sig v={e.significance} />
          </button>
        );
      })}
    </Panel>
  );
}

function AskCard() {
  const { go } = useNav();
  const qs = ['Which assets have milestones in the next six months?', 'What changed across my assets this month?', 'Compare Treprostinil with Yutrepia', 'Summarize the latest Phase 3 readouts'];
  return (
    <section className="panel ask">
      <div className="ask-h"><span className="tile vio"><Icon name="sparkles" size={16} /></span><div><h3>Asset AI</h3><p>Answers cite the records behind them.</p></div></div>
      <div className="ask-l">{qs.map((q) => <button key={q} className="ask-q" onClick={() => go({ page: 'chat', ask: q })}>{q}<Icon name="arrowR" size={13} /></button>)}</div>
      <button className="btn btn-sm ask-add" onClick={() => go({ page: 'chat', intent: 'add' })}><Icon name="plus" size={14} />Add an asset by chatting</button>
    </section>
  );
}

function HomePage({ b }) {
  const [sel, setSel] = hS(null);
  const evs = allEvents(b);
  const selList = sel ? eventsFor(sel.asset, b).sort((a, z) => a.date.localeCompare(z.date)) : [];
  return (
    <div className="dash">
      <DashHero b={b} evs={evs} />
      <DashKpis b={b} evs={evs} />
      <PortfolioTimeline b={b} onOpen={setSel} />
      <div className="dash-g">
        <WhatChanged evs={evs} onOpen={setSel} />
        <div className="dash-col"><NextMilestones evs={evs} onOpen={setSel} /><CrawlsCard b={b} /></div>
      </div>
      <TrackedAssets b={b} />
      <div className="dash-g">
        <CompetitiveSignals onOpen={setSel} />
        <AskCard />
      </div>
      {sel && <EventSheet e={sel} list={selList} onClose={() => setSel(null)} onNav={(id) => setSel(selList.find((x) => x.id === id))} />}
    </div>
  );
}

Object.assign(window, { HomePage, JobBadge, JOB_ST, Spark });
