const { useState: dS, useEffect: dE, useRef: dR } = React;

function MiniDonut({ data, size = 92 }) {
  const tot = data.reduce((s, d) => s + d.v, 0) || 1, r = size / 2 - 7, C = 2 * Math.PI * r;
  let acc = 0;
  return <svg width={size} height={size} className="mdn">{data.map((d) => { const len = (d.v / tot) * C, el = <circle key={d.l} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.c} strokeWidth="12" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`} />; acc += len; return el; })}<text x="50%" y="48%" textAnchor="middle" className="mdn-n">{tot}</text><text x="50%" y="64%" textAnchor="middle" className="mdn-l">records</text></svg>;
}

function ContextStrip({ e, list, onPick }) {
  const ref = dR(null), w = useWidth(ref);
  const W = Math.max(w, 260), pad = 10;
  const ys = list.map((x) => yfrac(x.date)), y0 = Math.min(...ys) - 0.3, y1 = Math.max(...ys) + 0.3;
  const x = (d) => pad + ((yfrac(d) - y0) / (y1 - y0)) * (W - pad * 2);
  const idx = list.findIndex((z) => z.id === e.id);
  return (
    <div className="cx" ref={ref}>
      <svg width={W} height={46}>
        <line x1={pad} x2={W - pad} y1={20} y2={20} stroke="#e4e7ec" strokeWidth="2" />
        {AJ.TODAY >= list[0].date && <line x1={x(AJ.TODAY)} x2={x(AJ.TODAY)} y1={8} y2={32} stroke="#101828" strokeDasharray="2 2" />}
        {list.map((z) => <circle key={z.id} cx={x(z.date)} cy={20} r={z.id === e.id ? 7 : z.significance === 'High' ? 4.5 : 3.2} fill={z.id === e.id ? AJ.CAT[z.category].c : z.is_milestone ? '#fff' : AJ.CAT[z.category].c} stroke={z.id === e.id ? '#fff' : AJ.CAT[z.category].c} strokeWidth={z.id === e.id ? 2.5 : 1.2} opacity={z.id === e.id ? 1 : 0.55} className="cx-d" onClick={() => onPick(z.id)}><title>{z.title}</title></circle>)}
        <circle cx={x(e.date)} cy={20} r={11} fill="none" stroke={AJ.CAT[e.category].c} strokeOpacity=".35" strokeWidth="2" />
        <text x={pad} y={44} className="ft-yr">{list[0].date.slice(0, 4)}</text><text x={W - pad} y={44} className="ft-yr" textAnchor="end">{list[list.length - 1].date.slice(0, 4)}</text>
      </svg>
      <span className="cx-n mono">#{idx + 1} of {list.length}</span>
    </div>
  );
}

function TermBar({ a, b, label, c }) {
  const t0 = yfrac(a), t1 = yfrac(b), now = yfrac(AJ.TODAY), lo = Math.min(t0, now) - 0.5, hi = Math.max(t1, now) + 0.5;
  const p = (v) => ((v - lo) / (hi - lo)) * 100;
  const done = Math.min(1, Math.max(0, (now - t0) / (t1 - t0)));
  return (
    <div className="tb">
      <div className="tb-track"><span className="tb-bar" style={{ left: `${p(t0)}%`, width: `${p(t1) - p(t0)}%`, background: c + '26', borderColor: c }}><i style={{ width: `${done * 100}%`, background: c }}></i></span><span className="tb-now" style={{ left: `${p(now)}%` }}><em>Today</em></span></div>
      <div className="tb-l mono"><span>{a}</span><span>{label}</span><span>{b}</span></div>
    </div>
  );
}

function EventDetail({ e, list, onClose, onNav, onLocate }) {
  const navCtx = window.NavCtx ? React.useContext(window.NavCtx) : null;
  const [st] = useNotes();
  const [txt, setTxt] = dS('');
  const pool = list && list.length ? [...list].sort((a, z) => a.date.localeCompare(z.date)) : [e];
  const idx = pool.findIndex((x) => x.id === e.id);
  const prev = pool[idx - 1], next = pool[idx + 1];
  dE(() => {
    const k = (ev) => { if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT') return; if (ev.key === 'Escape') onClose(); if (ev.key === 'ArrowLeft' && prev) onNav(prev.id); if (ev.key === 'ArrowRight' && next) onNav(next.id); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [e.id]);
  const m = AJ.CAT[e.category], asset = e.asset || 'treprostinil';
  const brs = AJ.BRANCHES[asset], lane = brs && brs.find((l) => l.id === (e.user ? e.user.lane : AJ.LANE_OF[e.id] || brs[0].id));
  const lineage = []; if (lane && brs) { let l = lane; while (l) { lineage.unshift(l); l = l.from && brs.find((x) => x.id === l.from); } }
  const laneEvs = lane ? pool.filter((x) => (x.user ? x.user.lane : AJ.LANE_OF[x.id] || brs[0].id) === lane.id) : [];
  const li = laneEvs.findIndex((x) => x.id === e.id), lprev = laneEvs[li - 1];
  const gapDays = lprev ? Math.round((new Date(e.date) - new Date(lprev.date)) / 864e5) : null;
  const rec = window.PE_REC && PE_REC[asset];
  const trial = rec && e.nct_id && rec.clinical.find((t) => t.nct === e.nct_id);
  const pat = rec && e.category === 'ip' && rec.patents.find((p) => p.ev === e.id || (e.details && p.num === e.details.Patent));
  const regRow = rec && rec.regulatory.find((r) => r.ev === e.id);
  const regPath = regRow ? rec.regulatory.filter((r) => r.product === regRow.product).sort((a, z) => a.date.localeCompare(z.date)) : null;
  const byColl = Object.entries(e.sources.reduce((acc, s) => ((acc[s.collection] = (acc[s.collection] || 0) + 1), acc), {})).map(([k, v]) => ({ l: k, v, c: AJ.COLL[k].c }));
  const linked = (e.links || []).map((id) => pool.find((x) => x.id === id) || AJ.byEvent[id]).filter(Boolean);
  const starred = st.stars.includes(e.id), comments = st.comments[e.id] || [];
  const det = Object.entries(e.details || {});
  const locate = () => { if (onLocate) { onLocate(e.id); onClose(); } else if (navCtx) { onClose(); navCtx.go({ page: 'asset', id: asset, tab: 'overview', focus: e.id }); } };
  const send = () => { if (!txt.trim()) return; addComment(e.id, txt.trim()); setTxt(''); };
  return ReactDOM.createPortal(
    <>
      <div className="sheet-ov" onClick={onClose}></div>
      <aside className="sheet ed" role="dialog" aria-label={e.title}>
        <div className="sh-h">
          <div className="sh-cat"><CatIcon cat={e.category} size={28} /><span>{m.label}</span>{lane && lane.label && <span className="ln-chip" style={{ color: lane.c, background: lane.c + '14', borderColor: lane.c + '40' }}><i style={{ background: lane.c }}></i>{lane.label}</span>}{e.user && <span className="nt-tag" style={{ '--tc': NOTE_TAGS[e.user.tag] }}>{e.user.tag}</span>}</div>
          <div className="ed-acts">
            <button className={'icon-btn star' + (starred ? ' on' : '')} aria-pressed={starred} aria-label="Mark as important" onClick={() => toggleStar(e.id)}><Icon name="star" size={16} /></button>
            <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
        </div>
        <div className="sh-b" key={e.id}>
          <p className="ed-type mono">{e.type.replace(/_/g, ' ')}</p>
          <h2>{e.title}</h2>
          <div className="sh-facts">
            <span className="mono">{e.is_milestone ? `Expected ${fmtDate(e.date)}` : fmtDate(e.date)}</span>
            {e.is_milestone && <span className="jx-cd"><Icon name="clock" size={11} />{relFuture(e.date)}</span>}
            {[e.region, e.phase, e.nct_id].filter(Boolean).map((c) => <span key={c} className="tag mono">{c}</span>)}
            <Sig v={e.significance} />
          </div>
          {(onLocate || navCtx) && <button className="btn btn-sm ed-loc" onClick={locate}><Icon name="route" size={14} />{onLocate ? 'Locate on timeline' : 'Show on the journey timeline'}<Icon name="arrowR" size={13} /></button>}
          {e.summary && <p className="sh-sum">{e.summary}</p>}

          {pool.length > 1 && <div className="ed-sec"><div className="sh-lbl">Position in the journey</div><ContextStrip e={e} list={pool} onPick={onNav} /></div>}

          {lineage.length > 0 && (
            <div className="ed-sec"><div className="sh-lbl">Branch</div>
              <div className="ed-lin">{lineage.map((l, i) => <React.Fragment key={l.id}>{i > 0 && <Icon name="chevR" size={12} className="muted" />}<span className={'ln-chip' + (l.id === lane.id ? ' cur' : '')} style={{ color: l.c, background: l.c + '14', borderColor: l.c + '40' }}><i style={{ background: l.c }}></i>{l.label}</span></React.Fragment>)}</div>
              <p className="ed-note">{lane.full} · {lane.status}. Event {li + 1} of {laneEvs.length} on this branch{gapDays != null ? `, ${gapDays > 400 ? (gapDays / 365).toFixed(1) + ' years' : gapDays + ' days'} after “${lprev.title}”` : ''}.</p>
            </div>
          )}

          {(e.ind.length > 0 || e.product) && <div className="ed-sec"><div className="sh-lbl">Targets</div><div className="tc-targets">{e.ind.map((i) => <span key={i} className="ind" style={{ background: m.soft, color: m.c }}>{i}</span>)}{e.product && <span className="prod"><Icon name="pill" size={11} />{e.product}</span>}</div></div>}

          {trial && <div className="ed-sec"><div className="sh-lbl">Trial · {trial.name !== '—' ? trial.name : trial.nct}</div><TermBar a={trial.start} b={trial.pcd} label={`${trial.phase} · n=${trial.n}`} c={m.c} /><p className="ed-note">{trial.title} · {trial.status} · {trial.sponsor}</p></div>}
          {pat && <div className="ed-sec"><div className="sh-lbl">Patent term · {pat.num}</div><TermBar a={pat.granted} b={pat.expiry} label={pat.status} c={m.c} /><p className="ed-note">{pat.title} · covers {pat.prod}</p></div>}
          {regPath && regPath.length > 1 && (
            <div className="ed-sec"><div className="sh-lbl">Regulatory path · {regRow.product}</div>
              <ol className="ed-path">{regPath.map((r) => <li key={r.key} className={r.ev === e.id ? 'cur' : ''}><span className="mono">{r.date}</span><span>{r.type} · {r.cls}</span><StBadgeD v={r.status} /></li>)}</ol>
            </div>
          )}

          {det.length > 0 && <div className="ed-sec"><div className="sh-lbl">Details</div><dl className="tc-det">{det.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={/^(NCT|NDA|ANDA|BLA|US |PMID|EMEA)/.test(v) ? 'mono' : ''}>{v}</dd></div>)}</dl></div>}
          {e.impact && <p className="tc-imp"><b>Why it matters · </b>{e.impact}</p>}

          <div className="ed-sec"><div className="sh-lbl">Evidence</div>
            {e.sources.length ? (
              <div className="ed-ev"><MiniDonut data={byColl} /><ul className="sh-src">{e.sources.map((s) => <li key={s.record_key}><span className="dot" style={{ background: AJ.COLL[s.collection].c }}></span><div><div className="mono k">{s.record_key}</div><div className="c">{s.collection} · {AJ.COLL[s.collection].tab} tab</div></div><a href="#" onClick={(ev) => ev.preventDefault()}>Open <Icon name="arrowUR" size={12} /></a></li>)}</ul></div>
            ) : <p className="ed-note">Added manually by {e.user && e.user.by}; no source records yet. It will be re-checked on the next refresh.</p>}
            <p className="ed-note">{e.via === 'ai_events' ? `Extracted and consolidated by AI from ${e.sources.length} records.` : e.via === 'finalize' ? 'Added when the journey was rebuilt with patents and the FDA calendar.' : e.via === 'user' ? (e.user.mode === 'ai' ? 'Found by Asset AI from your note.' : 'Added by a team member.') : `Mapped by rule (${e.type}).`}</p>
          </div>

          {linked.length > 0 && (
            <div className="ed-sec"><div className="sh-lbl">Linked events</div>
              <ul className="ed-links">{linked.map((l) => <li key={l.id}><button onClick={() => onNav(l.id)}><span className="tr-dot" style={{ background: AJ.CAT[l.category].c }}></span><span className="trunc">{l.title}</span><span className="mono muted">{l.date.slice(0, 7)}</span><Icon name="arrowR" size={12} /></button></li>)}</ul>
            </div>
          )}

          <div className="ed-sec"><div className="sh-lbl">Comments {comments.length > 0 && <span className="mono">· {comments.length}</span>}</div>
            {comments.map((c, i) => <div key={i} className="cm"><span className="av sm">{c.by.split(' ').map((p) => p[0]).join('')}</span><div><b>{c.by}</b><span className="muted"> · {new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span><p>{c.text}</p></div></div>)}
            <div className="cm-in"><textarea rows={2} value={txt} onChange={(ev) => setTxt(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); } }} placeholder="Add a comment for your team…" /><button className="btn btn-sm btn-p" disabled={!txt.trim()} onClick={send}>Comment</button></div>
          </div>
        </div>
        <div className="sh-f">
          <button className="btn btn-sm" disabled={!prev} onClick={() => prev && onNav(prev.id)}><Icon name="chevL" size={14} />{prev ? <span className="trunc">{prev.title}</span> : 'Previous'}</button>
          <button className="btn btn-sm" disabled={!next} onClick={() => next && onNav(next.id)}>{next ? <span className="trunc">{next.title}</span> : 'Next'}<Icon name="chevR" size={14} /></button>
        </div>
      </aside>
    </>, document.body);
}
const StBadgeD = ({ v }) => <span className={'jb jb-' + (/approv|authoris|positive/i.test(v) ? 'ok' : /review|expected|ongoing/i.test(v) ? 'run' : /complete response/i.test(v) ? 'bad' : '')}>{v}</span>;
window.EventSheet = EventDetail;
Object.assign(window, { EventDetail, MiniDonut });
