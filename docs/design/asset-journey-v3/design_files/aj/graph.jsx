const { useRef: gR, useMemo: gM } = React;

const AG_W = 1100, AG_H = 470, AG_OFF = 30;
const AG_SRC = ['regulatory', 'ema_chmp', 'fda_calendar', 'clinical', 'publications', 'conferences', 'patents', 'company_site', 'company_news', 'news', 'industry_news', 'competitors'];
const AG_COLL = ['fda_records', 'ema_records', 'trial_records', 'publication_records', 'conference_records', 'patent_records', 'company_records', 'articles'];
const AG_SRC_COLL = { regulatory: ['fda_records', 'ema_records'], ema_chmp: ['ema_records'], fda_calendar: ['fda_records'], clinical: ['trial_records'], publications: ['publication_records'], conferences: ['conference_records'], patents: ['patent_records'], company_site: ['company_records'], company_news: ['company_records'], news: ['articles'], industry_news: ['articles'] };
const AG_RULES_IN = ['fda_records', 'ema_records', 'trial_records', 'patent_records'];
const AG_TRIAGE_IN = ['publication_records', 'conference_records', 'company_records', 'articles'];

function agLayout() {
  const n = {}, o = AG_OFF;
  AG_SRC.forEach((k, i) => (n['s:' + k] = { x: 16, y: o + i * 34, w: 206, h: 28 }));
  AG_COLL.forEach((k, i) => (n['c:' + k] = { x: 300, y: o + 14 + i * 46, w: 176, h: 38 }));
  n['r:journey'] = { x: 548, y: o + 14, w: 228, h: 60 };
  n['r:ai_triage'] = { x: 548, y: o + 120, w: 228, h: 60 };
  n['r:ai_events'] = { x: 548, y: o + 214, w: 228, h: 60 };
  n['r:index'] = { x: 548, y: o + 318, w: 228, h: 60 };
  n['o:journey'] = { x: 846, y: o, w: 240, h: 230 };
  n['o:assetai'] = { x: 846, y: o + 244, w: 240, h: 70 };
  n['o:compset'] = { x: 846, y: o + 326, w: 240, h: 88 };
  return n;
}
const AG_N = agLayout();

function agEdges() {
  const E = [], C = AJ.COLL;
  AG_SRC.forEach((s) => (AG_SRC_COLL[s] || []).forEach((c) => E.push({ from: 's:' + s, to: 'c:' + c, steps: [s], color: C[c].c })));
  AG_RULES_IN.forEach((c, i) => E.push({ from: 'c:' + c, to: 'r:journey', steps: ['journey', 'finalize'], color: C[c].c, ty: 14 + i * 11 }));
  AG_TRIAGE_IN.forEach((c, i) => E.push({ from: 'c:' + c, to: 'r:ai_triage', steps: ['ai_triage'], color: C[c].c, ty: 14 + i * 11 }));
  E.push({ from: 'r:ai_triage', to: 'r:ai_events', steps: ['ai_events'], color: '#7a5af8', vertical: true });
  AG_COLL.forEach((c, i) => E.push({ from: 'c:' + c, to: 'r:index', steps: ['index'], color: C[c].c, ty: 12 + i * 5, faint: true }));
  E.push({ from: 'r:journey', to: 'o:journey', steps: ['journey', 'finalize'], color: '#2347d9', ty: 58 });
  E.push({ from: 'r:ai_events', to: 'o:journey', steps: ['ai_events'], color: '#7a5af8', ty: 168 });
  E.push({ from: 'r:index', to: 'o:assetai', steps: ['index'], color: '#475467' });
  E.push({ from: 's:competitors', to: 'o:compset', steps: ['competitors'], color: '#e0620f', under: true });
  return E.map((e, i) => ({ ...e, id: 'age-' + i, d: agPath(AG_N[e.from], AG_N[e.to], e) }));
}
function agPath(a, b, e) {
  if (e.vertical) { const x = a.x + a.w / 2; return `M${x},${a.y + a.h} C${x},${a.y + a.h + 14} ${x},${b.y - 14} ${x},${b.y}`; }
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = e.ty != null ? b.y + e.ty : b.y + b.h / 2;
  if (e.under) return `M${x1},${y1} C${x1 + 200},${y1 + 52} ${x2 - 260},${y2 + 52} ${x2},${y2}`;
  const dx = (x2 - x1) * 0.55;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}
const AG_EDGES = agEdges();
const AG_COLL_TOTAL = AJ.RECORDS.reduce((m, r) => ((m[r.coll] = (m[r.coll] || 0) + 1), m), {});
const agSpawn = (name) => 0.25 + AJ.byName[name].i * 0.14;

function StatusGlyph({ status, warn }) {
  if (status === 'running') return <Icon name="loader" size={13} className="spin ag-st run" />;
  if (status === 'done' && warn) return <span className="ag-st warn" title={warn}><Icon name="alert" size={12} /></span>;
  if (status === 'done') return <span className="ag-st ok"><Icon name="check" size={10} sw={3} /></span>;
  return <Icon name="dashed" size={13} className="ag-st pend" />;
}
const pos = (k) => { const n = AG_N[k]; return { left: n.x, top: n.y, width: n.w, height: n.h }; };

function nodeSpawn(k, b) {
  const [kind, name] = k.split(':');
  if (kind === 's' || kind === 'r') return agSpawn(name);
  if (kind === 'c') return b.collFirst[name];
  return agSpawn({ journey: 'journey', assetai: 'index', compset: 'competitors' }[name]);
}

function AgentGraph({ b }) {
  const ref = gR(null);
  const w = useWidth(ref);
  const scale = w ? Math.min(1.25, Math.max(0.58, w / AG_W)) : 1;
  const vis = (k) => { const at = nodeSpawn(k, b); return at !== undefined && b.t >= at; };
  const evVia = (v) => b.events.filter((e) => e.via === v).length;
  const st = b.st;

  const edges = AG_EDGES.filter((e) => vis(e.from) && vis(e.to)).map((e) => {
    const ss = e.steps.map((n) => st[n]);
    const state = ss.some((s) => s.status === 'running') ? 'active' : ss[0].status === 'done' ? 'done' : 'pending';
    return { ...e, state };
  });

  const reasonSub = {
    journey: (s) => s.status === 'pending' ? 'Waits for structured records' : `${evVia('journey')} events by rule`,
    ai_triage: (s) => s.status === 'pending' ? 'Waits for unstructured records' : s.status === 'running' ? `${s.live.triaged} of 186 triaged · ${s.live.relevant} relevant` : '74 kept · 112 dropped',
    ai_events: (s) => s.status === 'pending' ? 'Extract, date and consolidate' : `${evVia('ai_events')} events · ${s.live.extracted} candidates`,
    index: (s) => s.status === 'pending' ? 'Passages for Asset AI' : `${fmtNum(s.live.passages)} passages`,
  };
  const journeyStatus = st.finalize.status === 'done' ? 'done' : ['journey', 'ai_events', 'finalize'].some((n) => st[n].status === 'running') ? 'running' : b.events.length ? 'done-partial' : 'pending';
  const cats = Object.keys(AJ.CAT);
  const catCount = Object.fromEntries(cats.map((c) => [c, b.events.filter((e) => e.category === c).length]));
  const compNames = ['Yutrepia', 'Uptravi', 'Winrevair', 'Veletri', 'Ofev'];
  const compShown = st.competitors.status === 'done' ? 5 : st.competitors.status === 'running' ? Math.min(5, Math.floor(st.competitors.p * 6)) : 0;

  return (
    <div className="ag-wrap" ref={ref} style={{ height: AG_H * scale + 16 }}>
      <div className="ag-stage" style={{ transform: `translateX(${w ? Math.max(0, (w - AG_W * scale) / 2) : 0}px) scale(${scale})` }}>
        {[['Source agents', 16], ['Record store', 300], ['Reasoning', 548], ['Outputs', 846]].map(([l, x]) => <div key={l} className="ag-col" style={{ left: x }}>{l}</div>)}
        <svg className="ag-svg" width={AG_W} height={AG_H} viewBox={`0 0 ${AG_W} ${AG_H}`}>
          {edges.map((e) => (
            <g key={e.id} className={`ag-eg is-${e.state}${e.faint ? ' faint' : ''}`}>
              <path id={e.id} d={e.d} pathLength="1" className="ag-e draw" style={{ stroke: e.state === 'active' ? e.color : undefined }} />
              {e.state === 'active' && !REDUCED && [0, 1, 2].map((k) => (
                <circle key={k} r={e.faint ? 2 : 2.8} fill={e.color} className="ag-p">
                  <animateMotion dur={e.faint ? '1.1s' : '1.5s'} repeatCount="indefinite" begin={`-${k * 0.5}s`}><mpath href={'#' + e.id} /></animateMotion>
                </circle>
              ))}
            </g>
          ))}
        </svg>

        {AG_SRC.filter((n) => vis('s:' + n)).map((n) => {
          const s = st[n];
          const cnt = n === 'competitors' ? (s.status === 'pending' ? '' : s.live.competitors) : b.stepRecs[n] || (s.status === 'pending' ? '' : 0);
          return (
            <div key={n} className={`ag-node ag-src is-${s.status}`} style={pos('s:' + n)} title={s.label + (s.warnOn ? ' · ' + s.warn : '')}>
              <StatusGlyph status={s.status} warn={s.warnOn && s.warn} />
              <span className="lbl">{s.short}</span>
              <span className="cnt mono">{cnt}</span>
            </div>
          );
        })}

        {AG_COLL.filter((c) => vis('c:' + c)).map((c) => {
          const active = edges.some((e) => e.to === 'c:' + c && e.state === 'active');
          const n = b.collCount[c];
          return (
            <div key={c} className={`ag-node ag-coll${active ? ' is-filling' : ''}`} style={pos('c:' + c)}>
              <div className="row"><span className="mono nm">{c}</span><span className="mono ct">{fmtNum(n)}</span></div>
              <div className="bar"><i style={{ width: `${(n / AG_COLL_TOTAL[c]) * 100}%`, background: AJ.COLL[c].c }}></i></div>
            </div>
          );
        })}

        {['journey', 'ai_triage', 'ai_events', 'index'].filter((n) => vis('r:' + n)).map((n) => {
          const s = st[n];
          return (
            <div key={n} className={`ag-node ag-reason is-${s.status}`} style={pos('r:' + n)}>
              <span className="tile"><Icon name={s.icon} size={15} /></span>
              <div className="txt"><div className="lbl">{s.short}{n !== 'journey' && n !== 'index' && <span className="ai-tag">AI</span>}</div><div className="sub">{reasonSub[n](s)}</div></div>
              <StatusGlyph status={s.status} />
              {s.status === 'running' && <div className="pbar"><i style={{ width: `${s.p * 100}%` }}></i></div>}
            </div>
          );
        })}

        {vis('o:journey') && (
          <div className={`ag-node ag-out ag-journey is-${journeyStatus}`} style={pos('o:journey')}>
            <div className="hd"><span className="tile pri"><Icon name="route" size={15} /></span><span className="lbl">Journey</span>
              <span className={'pill ' + (st.finalize.status === 'done' ? 'ok' : b.events.length ? 'run' : '')}>{st.finalize.status === 'done' ? 'Ready' : b.events.length ? 'Building' : 'Waiting'}</span></div>
            <div className="big"><span className="n">{b.events.length}</span><span className="u">events</span></div>
            <div className="stack">{cats.map((c) => catCount[c] > 0 && <i key={c} style={{ flexGrow: catCount[c], background: AJ.CAT[c].c }}></i>)}{!b.events.length && <i style={{ flexGrow: 1, background: '#eef0f3' }}></i>}</div>
            <div className="legend">{cats.map((c) => <span key={c}><b style={{ background: AJ.CAT[c].c }}></b>{AJ.CAT[c].label}<em className="mono">{catCount[c]}</em></span>)}</div>
            <div className="ft mono">rules {evVia('journey')} · ai {evVia('ai_events')} · rebuild {evVia('finalize')}</div>
          </div>
        )}
        {vis('o:assetai') && (
          <div className={`ag-node ag-out is-${st.index.status}`} style={pos('o:assetai')}>
            <div className="hd"><span className="tile vio"><Icon name="sparkles" size={15} /></span><span className="lbl">Asset AI</span><StatusGlyph status={st.finalize.status === 'done' ? 'done' : st.index.status === 'running' ? 'running' : 'pending'} /></div>
            <div className="sub">{st.index.status === 'pending' ? 'Index builds after triage' : `${fmtNum(st.index.live.passages)} passages · ${st.finalize.live.suggested_questions} questions`}</div>
          </div>
        )}
        {vis('o:compset') && (
          <div className={`ag-node ag-out is-${st.competitors.status}`} style={pos('o:compset')}>
            <div className="hd"><span className="tile org"><Icon name="users" size={15} /></span><span className="lbl">Competitor set</span><StatusGlyph status={st.competitors.status} /></div>
            <div className="comps">{compShown === 0 ? <span className="sub">Top 5 by indication and mechanism</span> : compNames.slice(0, compShown).map((c) => <span key={c} className="cmp">{c}</span>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { AgentGraph });
