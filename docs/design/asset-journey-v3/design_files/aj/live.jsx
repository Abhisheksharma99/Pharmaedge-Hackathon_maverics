const { useState: lS, useRef: lR, useEffect: lE, useMemo: lM } = React;

function BuildStrip({ b, onExplore }) {
  const done = b.phase === 'done', planning = b.phase === 'planning';
  const cur = b.current;
  const elapsed = b.t * SIM_SCALE;
  const stages = ['Collect', 'Build', 'Expand', 'Finalize'].map((g) => ({ g, d: AJ.STEPS.filter((s) => s.stage === g).reduce((a, s) => a + s.dur, 0), on: cur && cur.stage === g }));
  return (
    <section className={'panel bstrip' + (done ? ' is-done' : '')} aria-live="polite">
      <div className="bs-top">
        <div className="bs-title">
          <span className={'bs-dot' + (done ? ' ok' : '')}>{done ? <Icon name="check" size={14} sw={3} /> : <i></i>}</span>
          <div>
            <h2>{planning ? 'Planning the crawl' : done ? 'Journey ready' : 'Building the journey'}</h2>
            <p>{planning ? `Laying out ${AJ.STEPS.length} steps across ${b.srcTotal} sources for Treprostinil`
              : done ? `${b.events.length} events from ${fmtNum(b.records.length)} records · finished in ${fmtDur(elapsed)}`
                : <>Step {cur.i + 1} of {AJ.STEPS.length} · <span className="bs-cur">{cur.label}</span></>}</p>
          </div>
        </div>
        <div className="bs-stats">
          {[['Records', fmtNum(b.records.length)], ['Events', b.events.length], ['Sources', `${b.srcDone}/${b.srcTotal}`], [done ? 'Duration' : 'Elapsed', fmtClock(elapsed)]].map(([l, v]) => (
            <div key={l} className="bs-stat"><div className="v">{v}</div><div className="l">{l}</div></div>
          ))}
          {done && <div className="bs-cta"><button className="btn btn-p" onClick={onExplore}>Explore the journey <Icon name="arrowR" size={15} /></button></div>}
        </div>
      </div>
      <div className="segbar" role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={AJ.STEPS.length} aria-valuenow={b.doneCount}>
        {b.steps.map((s) => <i key={s.name} title={`${s.i + 1}. ${s.label}`} className={s.status + (s.warnOn ? ' warn' : '')} style={{ flexGrow: s.dur, '--p': `${s.p * 100}%` }}></i>)}
      </div>
      <div className="stages">{stages.map((s) => <span key={s.g} className={s.on ? 'on' : ''} style={{ flexGrow: s.d }}>{s.g}</span>)}</div>
    </section>
  );
}

function FormingTimeline({ b }) {
  const ref = lR(null);
  const w = useWidth(ref);
  const [hover, setHover] = lS(null);
  const cats = Object.keys(AJ.CAT);
  const W = Math.max(w, 420), L = 92, R = 14, laneH = 30, top = 6;
  const x = (y) => L + ((y - AJ.Y0) / (AJ.Y1 - AJ.Y0)) * (W - L - R);
  const laneY = (c) => top + cats.indexOf(c) * laneH + laneH / 2;
  const recTop = top + cats.length * laneH + 12, recH = 30, axisY = recTop + recH + 16, H = axisY + 10;
  const step = W < 720 ? 4 : 2;
  const years = []; for (let y = AJ.Y0; y <= AJ.Y1; y += step) years.push(y);
  const tx = x(yfrac(AJ.TODAY));
  const hv = hover && b.events.find((e) => e.id === hover);
  const rNode = (e) => (e.significance === 'High' ? 6 : e.significance === 'Medium' ? 4.6 : 3.4);
  return (
    <div className="ft"><div className="ft-in" ref={ref}>
      <svg width={W} height={H} className="ft-svg">
        <defs><pattern id="ft-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#eef0f3" strokeWidth="2" /></pattern></defs>
        {cats.map((c, i) => (
          <g key={c}>
            <rect x={L} y={top + i * laneH} width={W - L - R} height={laneH} fill={i % 2 ? '#fff' : '#fafbfc'} />
            <circle cx={8} cy={laneY(c)} r={3.5} fill={AJ.CAT[c].c} />
            <text x={18} y={laneY(c) + 4} className="ft-lane">{AJ.CAT[c].label}</text>
          </g>
        ))}
        <rect x={tx} y={top} width={W - R - tx} height={recTop + recH - top} fill="url(#ft-hatch)" />
        {years.map((y) => <line key={y} x1={x(y)} x2={x(y)} y1={top} y2={recTop + recH} stroke="#eef0f3" />)}
        <rect x={L} y={recTop} width={W - L - R} height={recH} rx={6} fill="#f9fafb" stroke="#eef0f3" />
        <text x={18} y={recTop + 13} className="ft-lane">Records</text>
        <text x={18} y={recTop + 26} className="ft-cnt">{fmtNum(b.records.length)}</text>
        {b.records.map((r) => <rect key={r.id} className="ft-tick" x={x(r.y)} y={recTop + 4 + r.jitter * (recH - 16)} width={1.6} height={8} fill={AJ.COLL[r.coll].c} opacity={0.55} />)}
        {b.events.map((e) => {
          const ex = x(yfrac(e.date)), ey = laneY(e.category), c = AJ.CAT[e.category].c, r = rNode(e);
          return (
            <g key={e.id} onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(null)} className="ft-ev">
              <line className="ft-beam" x1={ex} x2={ex} y1={recTop + 2} y2={ey} stroke={c} strokeWidth={1.5} />
              <circle className="ft-ring" cx={ex} cy={ey} r={r} stroke={c} strokeWidth={1.5} />
              <circle className="ft-dot" cx={ex} cy={ey} r={r} fill={e.is_milestone ? '#fff' : c} stroke={e.is_milestone ? c : '#fff'} strokeWidth={e.is_milestone ? 1.6 : 1.2} strokeDasharray={e.is_milestone ? '2 1.6' : undefined} />
              <circle cx={ex} cy={ey} r={10} fill="transparent" />
            </g>
          );
        })}
        <line x1={tx} x2={tx} y1={top - 2} y2={recTop + recH + 4} stroke="#101828" strokeWidth={1} strokeDasharray="3 3" />
        <text x={tx} y={axisY} className="ft-today" textAnchor="middle">Today</text>
        {years.filter((y) => Math.abs(x(y) - tx) > 30).map((y) => <text key={y} x={x(y)} y={axisY} className="ft-yr" textAnchor="middle">{y}</text>)}
      </svg>
      {hv && (
        <div className="tip" style={{ left: x(yfrac(hv.date)), top: laneY(hv.category) - 6 }}>
          <b>{hv.title}</b><span>{fmtDate(hv.date)} · {hv.via === 'ai_events' ? `AI · ${hv.sources.length} records` : hv.via === 'finalize' ? 'Journey rebuild' : 'Rule'}</span>
        </div>
      )}
    </div></div>
  );
}

const viaLabel = (e) => e.via === 'user' ? (e.user.mode === 'ai' ? `You + AI · ${e.sources.length} sources` : 'Added by you') : e.via === 'ai_events' ? (e.sources.length > 1 ? `AI · merged ${e.sources.length} records` : 'AI · 1 record') : e.via === 'finalize' ? `Rebuild · ${e.sources[0].collection}` : `Rule · ${e.sources[0].collection}`;

function JustAdded({ b }) {
  const latest = [...b.events].sort((a, z) => z.at - a.at).slice(0, 5);
  return (
    <div className="ja">
      <div className="ja-h"><span>Just added</span>{b.events.length > 0 && <span className="mono">{b.events.length} events</span>}</div>
      {latest.length === 0 && <p className="ja-empty">Events appear here once the rules engine starts reading structured records.</p>}
      <ul>{latest.map((e) => (
        <li key={e.id} className="ja-row">
          <CatIcon cat={e.category} size={26} />
          <div className="ja-m"><div className="ja-t">{e.title}</div><div className="ja-s"><span className="mono">{fmtDate(e.date)}</span><span className={'via via-' + e.via}>{e.via === 'ai_events' && <Icon name="sparkles" size={11} />}{viaLabel(e)}</span></div></div>
          <Sig v={e.significance} />
        </li>
      ))}</ul>
    </div>
  );
}

function ActivityLog({ b }) {
  const ref = lR(null), stick = lR(true);
  const lines = b.logs.slice(-140);
  lE(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lines.length]);
  const running = b.phase !== 'done';
  return (
    <div className="log" ref={ref} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {lines.map((l, i) => {
        const last = i === lines.length - 1 && running;
        return (
          <div key={l.id} className={'log-l k-' + l.kind}>
            <span className="log-t mono">{fmtClock(l.t * SIM_SCALE)}</span>
            <div className="log-b">
              <span className="log-s">{l.step === 'plan' ? 'Plan' : AJ.byName[l.step].short}</span>
              <span className={'log-x' + (last ? ' caret' : '')}>
                {l.kind === 'event' && <><span className="plus">+</span><b>{l.text}</b>{l.merged > 1 && <span className="mg"><Icon name="merge" size={11} />{l.merged}</span>}</>}
                {l.kind === 'ai' && <><span className={'vd vd-' + l.verdict}>{l.verdict}</span>{l.text}</>}
                {l.kind === 'warn' && <><Icon name="alert" size={12} className="lw" />{l.text}</>}
                {l.kind === 'done' && <><Icon name="check" size={12} sw={2.6} className="ld" />{l.text}</>}
                {l.kind === 'info' && l.text}
                {l.kind === 'fx' && <><span className="fxp">3D</span>{l.text}<span className="muted"> · {l.why}</span></>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LiveBuild({ b, onExplore }) {
  return (
    <div className="live">
      <BuildStrip b={b} onExplore={onExplore} />
      <Panel title="Agent pipeline" desc="Source agents collect records into the store; rules and AI turn them into dated journey events."
        actions={<div className="ag-legend"><span><i className="lg pend"></i>Planned</span><span><i className="lg run"></i>Running</span><span><i className="lg ok"></i>Done</span></div>}>
        <AgentGraph b={b} />
      </Panel>
      <div className="live-grid">
        <Panel title="Journey taking shape" desc="Records land as ticks on the time axis; events crystallise in their lane as rules and AI find them.">
          <FormingTimeline b={b} />
          <JustAdded b={b} />
        </Panel>
        <Panel title="Activity" desc={b.phase === 'done' ? `${b.logs.length} entries` : 'Live from the crawl worker'} className="log-panel">
          <ActivityLog b={b} />
        </Panel>
      </div>
    </div>
  );
}

Object.assign(window, { LiveBuild, viaLabel });
