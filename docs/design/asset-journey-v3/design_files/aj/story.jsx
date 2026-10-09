const { useState: yS, useEffect: yE, useRef: yR, useMemo: yM, useLayoutEffect: yLE } = React;

function TreeNode({ n, depth, onJump }) {
  const [open, setOpen] = yS(depth < 1);
  const kids = n.c && n.c.length ? n.c : null;
  const dot = n.k === 'ev' ? AJ.CAT[n.cat].c : n.coll ? AJ.COLL[n.coll].c : null;
  return (
    <li className={'tw-n' + (kids ? ' has' : '')}>
      <button type="button" className={'tw-row' + (n.ev ? ' jump' : '')} onClick={() => (kids ? setOpen(!open) : n.ev && onJump(n.ev))} aria-expanded={kids ? open : undefined}>
        {kids ? <span className={'tw-chev' + (open ? ' on' : '')}><Icon name="chevR" size={11} /></span> : <span className="tw-leaf" style={dot ? { background: dot } : undefined}></span>}
        <span className={'tw-t' + (n.k === 'file' ? ' mono' : '')}>{n.t}</span>{n.s && <span className="tw-s">{n.s}</span>}
        {kids && <span className="tw-c mono">{kids.length}</span>}{n.ev && <Icon name="arrowR" size={12} className="tw-go" />}
      </button>
      {kids && open && <ul className="tw-l">{kids.map((c, i) => <TreeNode key={i} n={c} depth={depth + 1} onJump={onJump} />)}</ul>}
    </li>
  );
}

function TreeCard({ e, lane, open, onToggle, onJump, pool, starred, nComments, onDetails }) {
  const m = AJ.CAT[e.category];
  const t = yM(() => AJ.tree(e, pool), [e.id]);
  const nTree = t.reduce((s, n) => s + 1 + (n.c ? n.c.length : 0), 0);
  const det = Object.entries(e.details || {});
  return (
    <div className={'tc-card' + (e.user ? ' note' : '') + (starred ? ' starred' : '')} style={e.user ? { '--tc': NOTE_TAGS[e.user.tag] } : undefined}>
      {e.user && <div className="tc-note-h"><Icon name="flag" size={12} /><b>{e.user.tag}</b><span>{e.user.mode === 'ai' ? 'Found by Asset AI from' : 'Added by'} {e.user.by}</span></div>}
      <div className="tc-meta">
        <CatIcon cat={e.category} size={28} />
        <span className="tc-kind"><b style={{ color: m.c }}>{m.label}</b><span>{e.type.replace(/_/g, ' ')}</span></span>
        {lane && lane.label && <span className="ln-chip" style={{ color: lane.c, background: lane.c + '14', borderColor: lane.c + '40' }}><i style={{ background: lane.c }}></i>{lane.label}</span>}
        <span className="sp"></span>
        <span className="mono tc-date">{e.is_milestone ? `Expected ${fmtMonth(e.date)}` : fmtDate(e.date)}</span>
        {e.is_milestone && <span className="jx-cd"><Icon name="clock" size={11} />{relFuture(e.date)}</span>}
        <Sig v={e.significance} />
      </div>
      <h3 className="tc-title"><button type="button" className="tc-tlink" onClick={onDetails}>{e.title}</button></h3>
      {e.summary && <p className="tc-sum">{e.summary}</p>}
      {(e.ind.length > 0 || e.product) && (
        <div className="tc-targets">
          <span className="tc-lbl">Targets</span>
          {e.ind.map((i) => <span key={i} className="ind" style={{ background: m.soft, color: m.c }}>{i}</span>)}
          {e.product && <span className="prod"><Icon name="pill" size={11} />{e.product}</span>}
          {e.region && <span className="tag mono">{e.region}</span>}
        </div>
      )}
      {det.length > 0 && <dl className="tc-det">{det.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={/^(NCT|NDA|ANDA|BLA|US |PMID|EMEA)/.test(v) ? 'mono' : ''}>{v}</dd></div>)}</dl>}
      {e.impact && <p className="tc-imp"><b>Why it matters · </b>{e.impact}</p>}
      <div className="tc-foot">
        <span className={'via via-' + e.via}>{e.via === 'ai_events' && <Icon name="sparkles" size={11} />}{viaLabel(e)}</span>
        <span className="sp"></span>
        <button type="button" className={'tc-ib' + (starred ? ' star-on' : '')} aria-pressed={starred} title="Mark as important" onClick={() => toggleStar(e.id)}><Icon name="star" size={14} /></button>
        <button type="button" className="tc-ib" title="Comments" onClick={onDetails}><Icon name="msg" size={14} />{nComments > 0 && <span className="mono">{nComments}</span>}</button>
        <button type="button" className={'tc-tree-b' + (open ? ' on' : '')} onClick={onToggle} aria-expanded={open}><Icon name="list" size={13} />{open ? 'Hide subtree' : 'Subtree'}<span className="mono">{nTree}</span></button>
        <button type="button" className="tc-tree-b pri" onClick={onDetails}>Details<Icon name="arrowR" size={12} /></button>
      </div>
      {open && <ul className="tw-root">{t.map((n, i) => <TreeNode key={i} n={n} depth={0} onJump={onJump} />)}</ul>}
    </div>
  );
}

const GAP_W = 40, GAP_N = 16;

function JourneyStory({ events: baseEvents = AJ.EVENTS, kpis, scrollRef, onShowBuild, branches, focusId, asset, extra }) {
  const assetId = asset || (baseEvents === AJ.EVENTS ? 'treprostinil' : baseEvents[0] && baseEvents[0].asset);
  const [ns] = useNotes();
  const events = yM(() => [...baseEvents, ...ns.notes.filter((n) => n.asset === assetId).map(noteToEvent)], [baseEvents, ns.notes, assetId]);
  const brs = branches !== undefined ? branches : baseEvents === AJ.EVENTS ? AJ.BRANCHES.treprostinil : null;
  const B = yM(() => {
    const list = brs || [{ id: 'main', label: '', c: '#2347d9', off: 0, trunk: true }];
    return { list, by: Object.fromEntries(list.map((l) => [l.id, l])), multi: !!brs };
  }, [brs]);
  const laneOf = (e) => (e.user ? (B.by[e.user.lane] ? e.user.lane : B.list[0].id) : B.multi && AJ.LANE_OF[e.id] && B.by[AJ.LANE_OF[e.id]] ? AJ.LANE_OF[e.id] : B.list[0].id);
  const [orient, setOrient] = yS(() => localStorage.getItem('aj.orient') || 'h');
  const [mine, setMine] = yS(null);
  const [detail, setDetail] = yS(null);
  const [composer, setComposer] = yS(null);
  const [gh, setGh] = yS(null);
  const gutAt = (ev) => {
    const flow = flowRef.current; if (!flow || !geo) return null;
    const fr = flow.getBoundingClientRect(), x = ev.clientX - fr.left, y = ev.clientY - fr.top;
    const live = geo.lanes.filter((l) => y >= (l.px !== undefined ? l.fy : l.y1) && y <= l.y2 + 20);
    const ln = (live.length ? live : geo.lanes.filter((l) => l.trunk)).reduce((b, l) => (!b || Math.abs(l.x - x) < Math.abs(b.x - x) ? l : b), null);
    const ns = [...geo.nodes].sort((a, z) => a.y - z.y), ev2 = (k) => events.find((e) => e.id === k);
    let i = ns.findIndex((n) => n.y > y); if (i < 0) i = ns.length;
    const A = ns[i - 1] && ev2(ns[i - 1].k), Z = ns[i] && ev2(ns[i].k);
    let f = A ? yfrac(A.date) : Z ? yfrac(Z.date) : yfrac(AJ.TODAY);
    if (A && Z && ns[i].y !== ns[i - 1].y) f = yfrac(A.date) + ((y - ns[i - 1].y) / (ns[i].y - ns[i - 1].y)) * (yfrac(Z.date) - yfrac(A.date));
    const yy = Math.floor(f), mf = (f - yy) * 12, mm = Math.min(12, Math.max(1, Math.floor(mf) + 1)), dd = Math.min(28, Math.max(1, Math.round((mf - (mm - 1)) * 28) + 1));
    return { y, lx: ln.x, lane: ln.id, c: ln.c, label: ln.label, date: `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, prev: A, next: Z };
  };
  yE(() => { localStorage.setItem('aj.orient', orient); }, [orient]);
  const [scope, setScope] = yS('key');
  const [cats, setCats] = yS([]);
  const [focus, setFocus] = yS(null);
  const [active, setActive] = yS(0);
  const [revealed, setRevealed] = yS(() => new Set());
  const [openT, setOpenT] = yS(() => new Set());
  const [geo, setGeo] = yS(null);
  const flowRef = yR(null), clipRef = yR(null), lanesHdr = yR(null);
  const list = yM(() => events.filter((e) => (scope === 'all' || e.significance !== 'Low' || e.user) && (!cats.length || cats.includes(e.category)) && (!mine || (mine === 'starred' ? ns.stars.includes(e.id) : !!e.user))).sort((a, z) => a.date.localeCompare(z.date)), [events, scope, cats, mine, ns.stars]);
  const sig = list.map((e) => e.id).join(',');

  const offs = B.list.map((l) => l.off), mn = Math.min(0, ...offs), mx = Math.max(0, ...offs);
  const gl = -mn * GAP_W + 30, gr = mx * GAP_W + 30;
  const flowVars = { '--gw': `${gl + gr}px`, '--tshift': `${(gl - gr) / 2}px`, '--ntx': `${14 + -mn * GAP_N}px`, '--nw': `${14 + (mx - mn) * GAP_N + 26}px` };

  const rows = yM(() => {
    const out = []; let yr = null, today = false, tr = 0;
    const seen = new Set();
    const lastOf = {}; list.forEach((e) => (lastOf[laneOf(e)] = e.id));
    const cnt = {}; list.forEach((e) => (cnt[laneOf(e)] = (cnt[laneOf(e)] || 0) + 1));
    list.forEach((e, i) => {
      const y = e.date.slice(0, 4), ln = laneOf(e), L = B.by[ln];
      if (!today && e.is_milestone) { out.push({ k: 'today', t: 'today' }); today = true; }
      if (y !== yr) { out.push({ k: 'y' + y, t: 'year', y, n: list.filter((x) => x.date.slice(0, 4) === y).length }); yr = y; }
      const side = L.off < 0 ? 'l' : L.off > 0 ? 'r' : tr++ % 2 ? 'l' : 'r';
      if (B.multi && !L.trunk && !seen.has(ln)) { seen.add(ln); out.push({ k: 'f' + ln, t: 'fork', L, side: L.off < 0 ? 'l' : 'r', n: cnt[ln], e }); }
      out.push({ k: e.id, t: 'ev', e, i, side, ln });
      if (B.multi && L.ended && lastOf[ln] === e.id) out.push({ k: 'x' + ln, t: 'end', L, side: L.off < 0 ? 'l' : 'r', e });
    });
    return out;
  }, [sig, B]);

  const layout = () => {
    const flow = flowRef.current; if (!flow) return;
    const W = flow.clientWidth, narrow = W < 980, gap = narrow ? GAP_N : GAP_W;
    const tx = narrow ? 14 + -mn * GAP_N : Math.round((W + gl - gr) / 2);
    const lx = (id) => tx + B.by[id].off * gap;
    const mid = (el) => el.offsetTop + el.offsetHeight / 2;
    const nodes = [];
    flow.querySelectorAll('[data-i]').forEach((art) => {
      const card = art.querySelector('.tc-card'); if (!card) return;
      const y = art.offsetTop + card.offsetTop + 34, left = art.offsetLeft + card.offsetLeft, w = card.offsetWidth;
      const side = narrow ? 'r' : art.dataset.side, ln = art.dataset.lane;
      nodes.push({ k: art.dataset.k, y, lane: ln, x: lx(ln), x2: side === 'r' ? left : left + w, up: art.dataset.up === '1', hi: art.dataset.sig === 'High', note: art.dataset.note || null, span: AJ.SPAN[art.dataset.k] && B.multi ? AJ.SPAN[art.dataset.k].filter((s) => B.by[s]) : null });
    });
    const q = (s) => flow.querySelector(s);
    const yToday = q('.tc-today') ? mid(q('.tc-today')) : null;
    const yEnd = q('.tc-end') ? q('.tc-end').offsetTop + 14 : flow.scrollHeight - 40;
    const yRoot = q('.tc-root') ? q('.tc-root').offsetTop + 15 : 12;
    const started = {};
    const lanes = [];
    B.list.forEach((l) => {
      if (l.trunk) { lanes.push({ ...l, x: lx(l.id), y1: yRoot, y2: yEnd }); started[l.id] = yRoot; return; }
      const f = q(`[data-fork="${l.id}"]`); if (!f) return;
      const fy = mid(f), fp = f.querySelector('.tc-fork');
      const parent = l.from && started[l.from] !== undefined && started[l.from] < fy ? l.from : B.list[0].id;
      const ns = nodes.filter((n) => n.lane === l.id), last = ns[ns.length - 1];
      const xr = q(`[data-endl="${l.id}"]`);
      const y2 = xr ? mid(xr) : Math.max(last ? last.y : fy, yToday != null && !last?.up ? Math.min(yToday, yEnd) : last ? last.y : fy);
      const fx2 = fp ? (narrow || f.dataset.side === 'r' ? f.offsetLeft + fp.offsetLeft : f.offsetLeft + fp.offsetLeft + fp.offsetWidth) : lx(l.id);
      lanes.push({ ...l, x: lx(l.id), px: lx(parent), fy, y1: fy, y2: Math.max(y2, last ? last.y : fy), fx2, ended: !!xr });
      started[l.id] = fy;
    });
    const xs = lanes.map((l) => l.x);
    const g = { W, H: flow.scrollHeight, tx, gap, narrow, nodes, lanes, yToday, yEnd, xMin: Math.min(...xs), xMax: Math.max(...xs) };
    setGeo((p) => (p && JSON.stringify(p) === JSON.stringify(g) ? p : g));
  };
  yLE(layout, [rows, openT, orient]);
  yE(() => { const flow = flowRef.current; if (!flow) return; const ro = new ResizeObserver(() => layout()); ro.observe(flow); return () => ro.disconnect(); }, [sig, B, orient]);

  yE(() => {
    const sc = scrollRef.current, flow = flowRef.current; if (!sc || !flow) return;
    let raf = 0;
    const update = () => {
      const sr = sc.getBoundingClientRect(), fr = flow.getBoundingClientRect(), vc = sr.top + sr.height * 0.55, yRel = vc - fr.top;
      if (clipRef.current) clipRef.current.setAttribute('height', String(Math.max(0, yRel)));
      if (lanesHdr.current) lanesHdr.current.querySelectorAll('[data-ly]').forEach((el) => el.classList.toggle('on', +el.dataset.ly <= yRel));
      flow.querySelectorAll('.tc-bgyear').forEach((el) => { const r = el.parentElement.getBoundingClientRect(); el.style.transform = `translate(-50%, ${((r.top + r.height / 2 - vc) * -0.45).toFixed(1)}px)`; });
      let best = 0, bd = Infinity;
      flow.querySelectorAll('[data-i]').forEach((el) => { const r = el.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - vc); if (d < bd) { bd = d; best = +el.dataset.i; } });
      setActive(best);
    };
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    sc.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on); update();
    const io = new IntersectionObserver((ents) => {
      const ins = ents.filter((x) => x.isIntersecting); if (!ins.length) return;
      ins.forEach((x, i) => { x.target.style.setProperty('--dl', `${Math.min(i, 4) * 90}ms`); io.unobserve(x.target); });
      setRevealed((p) => { const n = new Set(p); ins.forEach((x) => n.add(x.target.dataset.k)); return n; });
    }, { root: sc, threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    flow.querySelectorAll('[data-k]').forEach((el) => { if (!revealed.has(el.dataset.k)) io.observe(el); });
    return () => { sc.removeEventListener('scroll', on); window.removeEventListener('resize', on); cancelAnimationFrame(raf); io.disconnect(); };
  }, [sig, scrollRef, geo && geo.H, orient]);

  const jump = (id, tries = 0) => {
    if (orient === 'h' && window.__hzGo) { if (list.some((e) => e.id === id)) { window.__hzGo(id); return; } }
    const sc = scrollRef.current, el = flowRef.current && flowRef.current.querySelector(`[data-k="${id}"]`);
    if (!el || (orient === 'h' && !list.some((e) => e.id === id))) { if (tries < 3) { setScope('all'); setCats([]); setMine(null); setTimeout(() => jump(id, tries + 1), 250); } return; }
    if (!sc) return;
    const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    sc.scrollTo({ top: sc.scrollTop + r.top - sr.top - sr.height * 0.3, behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  };
  const focusDone = yR(null);
  yE(() => {
    if (!focusId || focusDone.current === focusId || !list.length) return;
    if (orient === 'v' && !geo) return;
    focusDone.current = focusId;
    setTimeout(() => { jump(focusId); setDetail(focusId); }, 200);
  }, [focusId, geo, orient, list.length]);
  const openDetail = (id) => setDetail(id);
  const detailE = detail && events.find((x) => x.id === detail);
  const sortedAll = yM(() => [...events].sort((a, z) => a.date.localeCompare(z.date)), [events]);
  const toggleT = (id) => setOpenT((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const cur = list[Math.min(active, list.length - 1)];
  const curLane = cur && B.by[laneOf(cur)];
  const span = list.length ? `${list[0].date.slice(0, 4)}–${list[list.length - 1].date.slice(0, 4)}` : '';
  const laneCount = B.list.filter((l) => list.some((e) => laneOf(e) === l.id)).length;
  const dim = (ln) => focus && focus !== ln;

  return (
    <div className="jx">
      <KpiStrip items={kpis} />
      {extra}
      <section className="tc">
        <div className="tc-head">
          <div className="panel-t"><h3>Journey</h3><p>{list.length} events, {span}{B.multi ? ` · ${laneCount} indication branches` : ''}. {B.multi ? 'Each new indication forks off the programme that led to it; select a branch to focus it.' : 'Open a card’s subtree for its evidence and linked events.'}</p></div>
          <div className="jx-acts">
            {onShowBuild && <button className="btn btn-sm btn-ghost" onClick={onShowBuild}><Icon name="activity" size={14} />How this journey was built</button>}
            <Seg label="Orientation" value={orient} onChange={setOrient} options={[{ value: 'v', label: 'Tree', icon: 'rows' }, { value: 'h', label: 'Horizontal', icon: 'columns' }]} />
            <Seg label="Events shown" value={scope} onChange={setScope} options={[{ value: 'key', label: 'Key events' }, { value: 'all', label: 'All' }]} />
            <button className="btn btn-sm btn-p" onClick={() => setComposer({ date: AJ.TODAY, lane: B.list[0].id })}><Icon name="plus" size={14} />Add to timeline</button>
          </div>
          {B.multi && (
            <div className="tc-brs">
              {B.list.map((l) => {
                const n = list.filter((e) => laneOf(e) === l.id).length;
                const first = list.find((e) => laneOf(e) === l.id);
                return (
                  <button key={l.id} type="button" aria-pressed={focus === l.id} className={'br-c' + (focus === l.id ? ' on' : '') + (dim(l.id) ? ' dim' : '') + (n ? '' : ' none')} style={{ '--lc': l.c }} onClick={() => setFocus(focus === l.id ? null : l.id)} disabled={!n}>
                    <span className="br-top"><i></i><b>{l.label}</b>{l.trunk ? <span className="br-t">Trunk</span> : <span className="br-t">from {B.by[l.from].label}</span>}<span className="mono br-n">{n}</span></span>
                    <span className="br-full">{l.full}</span>
                    <span className={'br-st' + (l.ended ? ' x' : '')}>{l.status}{first ? ` · since ${first.date.slice(0, 4)}` : ''}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="tc-chips">{Object.entries(AJ.CAT).map(([c, mm]) => <button key={c} type="button" aria-pressed={cats.includes(c)} className={'fchip' + (cats.includes(c) ? ' on' : '')} onClick={() => setCats((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}><i className="dot" style={{ background: mm.c }}></i>{mm.label}<span className="n mono">{events.filter((e) => e.category === c && (scope === 'all' || e.significance !== 'Low')).length}</span></button>)}<span className="tc-sep"></span><button type="button" aria-pressed={mine === 'starred'} className={'fchip' + (mine === 'starred' ? ' on' : '')} onClick={() => setMine(mine === 'starred' ? null : 'starred')}><Icon name="star" size={12} />Starred<span className="n mono">{ns.stars.filter((id) => events.some((e) => e.id === id)).length}</span></button><button type="button" aria-pressed={mine === 'notes'} className={'fchip' + (mine === 'notes' ? ' on' : '')} onClick={() => setMine(mine === 'notes' ? null : 'notes')}><Icon name="flag" size={12} />Team notes<span className="n mono">{events.filter((e) => e.user).length}</span></button>{(cats.length > 0 || focus || mine) && <button className="clear" onClick={() => { setCats([]); setFocus(null); setMine(null); }}>Clear</button>}</div>
        </div>

        {orient === 'h' ? (
          <HorizontalTrack list={list} B={B} laneOf={laneOf} scrollRef={scrollRef} onOpen={openDetail} focusId={focusId} active={active} setActive={setActive} stars={ns.stars} comments={ns.comments} onAdd={(x) => setComposer(x)} />
        ) : (
        <div className={'tc-flow' + (B.multi ? ' multi' : '') + (focus ? ' focusing' : '')} ref={flowRef} style={flowVars}>
          {B.multi && geo && geo.narrow && (
            <div className="tc-lanes nb" ref={lanesHdr} aria-hidden="true">
              <div className="tc-nbar">{geo.lanes.map((l) => <span key={l.id} data-ly={l.y1} className="tc-lh2" style={{ '--lc': l.c }}><i></i>{l.label}</span>)}</div>
            </div>
          )}
          {B.multi && geo && !geo.narrow && (
            <div className="tc-lanes" ref={lanesHdr} aria-hidden="true">
              {[...geo.lanes].sort((a, z) => a.x - z.x).map((l, i) => <span key={l.id} data-ly={l.y1} className={'tc-lh' + (dim(l.id) ? ' dim' : '')} style={{ left: l.x, top: i % 2 ? 32 : 8, '--lc': l.c }}>{l.label}</span>)}
            </div>
          )}
          {geo && (
            <div className="tc-gut" style={{ left: Math.max(0, geo.xMin - 22), width: geo.xMax - Math.max(0, geo.xMin - 22) + 22, height: geo.H }} onMouseMove={(ev) => setGh(gutAt(ev))} onMouseLeave={() => setGh(null)} onClick={(ev) => { const q = gutAt(ev); if (q) setComposer({ date: q.date, lane: q.lane, prev: q.prev && q.prev.title, next: q.next && q.next.title }); }}>
              {gh && <><span className="tc-gl" style={{ top: gh.y, left: gh.lx - Math.max(0, geo.xMin - 22) - 9, '--lc': gh.c }}><Icon name="plus" size={11} /></span><span className={'add-pill v' + (geo.narrow ? ' nar' : '')} style={{ top: gh.y, left: gh.lx - Math.max(0, geo.xMin - 22) + 16, '--lc': gh.c }}><b>{fmtDate(gh.date)}</b>{B.multi && <span>· {gh.label}</span>}<em>Click to add a note</em></span></>}
            </div>
          )}
          {geo && (
            <svg className="tc-svg" width={geo.W} height={geo.H} aria-hidden="true">
              <defs><clipPath id="tc-lit"><rect ref={clipRef} x="0" y="0" width={geo.W} height="0" /></clipPath></defs>
              {[false, true].map((lit) => (
                <g key={String(lit)} clipPath={lit ? 'url(#tc-lit)' : undefined} className={lit ? 'tc-lit' : 'tc-base'}>
                  {geo.lanes.map((l) => {
                    const c = lit ? l.c : '#e4e7ec', yt = geo.yToday;
                    const solidEnd = yt != null && !l.ended ? Math.min(l.y2, yt) : l.y2;
                    return (
                      <g key={l.id} className={dim(l.id) ? 'dim' : ''}>
                        {lit && B.multi && Array.from({ length: Math.max(0, Math.floor((l.y2 - l.y1 - 260) / 620)) }, (_, k) => l.y1 + 300 + k * 620).map((yy) => <text key={yy} transform={`translate(${l.x + (geo.narrow ? 4 : 7)},${yy}) rotate(90)`} className="tc-vlab" fill={l.c}>{l.label}</text>)}
                        {l.px !== undefined && <path d={`M${l.px},${l.fy - 58} C${l.px},${l.fy - 26} ${l.x},${l.fy - 34} ${l.x},${l.fy - 6}`} stroke={c} className="tc-fk" />}
                        <line x1={l.x} x2={l.x} y1={l.px !== undefined ? l.fy - 6 : l.y1} y2={solidEnd} stroke={c} className={'tc-ln' + (l.trunk ? ' trunk' : '')} />
                        {yt != null && !l.ended && l.y2 > yt && <line x1={l.x} x2={l.x} y1={yt} y2={l.y2} stroke={c} className={'tc-ln fut' + (l.trunk ? ' trunk' : '')} />}
                      </g>
                    );
                  })}
                </g>
              ))}
              {geo.yToday != null && <line x1={geo.xMin - 18} x2={geo.xMax + 18} y1={geo.yToday} y2={geo.yToday} className="tc-todayln" />}
              {geo.lanes.filter((l) => l.px !== undefined).map((l) => (
                <g key={'f' + l.id} className={'tc-fc' + (revealed.has('f' + l.id) ? ' in' : '') + (dim(l.id) ? ' dim' : '')}>
                  <path d={`M${l.x},${l.fy} L${l.fx2},${l.fy}`} pathLength="1" style={{ stroke: l.c }} />
                  <circle cx={l.x} cy={l.fy} r="5" style={{ fill: '#fff', stroke: l.c }} />
                </g>
              ))}
              {geo.lanes.filter((l) => l.ended).map((l) => (
                <g key={'x' + l.id} transform={`translate(${l.x},${l.y2})`}><g className={'tc-cap' + (revealed.has('x' + l.id) ? ' in' : '')}>
                  <circle r="8" style={{ stroke: l.c }} /><path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2" style={{ stroke: l.c }} />
                </g></g>
              ))}
              {geo.nodes.map((n) => {
                const L = B.by[n.lane], on = cur && cur.id === n.k, xs = n.span ? n.span.map((s) => geo.tx + B.by[s].off * geo.gap) : null;
                return (
                  <g key={n.k} className={'tc-br' + (revealed.has(n.k) ? ' in' : '') + (on ? ' act' : '') + (n.up ? ' up' : '') + (dim(n.lane) ? ' dim' : '')}>
                    <path d={`M${n.x},${n.y} L${n.x2},${n.y}`} pathLength="1" style={{ stroke: L.c }} />
                    {xs && <line x1={Math.min(...xs)} x2={Math.max(...xs)} y1={n.y} y2={n.y} className="tc-span" style={{ stroke: L.c }} />}
                    {xs && xs.filter((x) => x !== n.x).map((x) => <circle key={x} cx={x} cy={n.y} r="3.5" className="tc-sd" style={{ fill: '#fff', stroke: L.c }} />)}
                    <circle cx={n.x} cy={n.y} r={on ? 8 : n.hi ? 6.5 : 5} style={{ fill: n.up || n.note ? '#fff' : L.c, stroke: n.note ? n.note : n.up ? L.c : '#fff' }} className="tc-nd" />
                    <circle cx={n.x2} cy={n.y} r={2.5} style={{ fill: L.c }} className="tip-dot" />
                  </g>
                );
              })}
            </svg>
          )}
          <div className="tc-root"><div className="tc-mk"><span className="tc-seed"><Icon name="pill" size={14} /></span><span>Journey begins · <b>{list[0] ? fmtMonth(list[0].date) : ''}</b>{B.multi && <> · <b style={{ color: B.list[0].c }}>{B.list[0].label}</b> trunk</>}</span></div></div>
          {rows.map((r) => {
            const rv = revealed.has(r.k) ? ' in' : '';
            if (r.t === 'year') return <div key={r.k} data-k={r.k} className={'tc-year' + rv}><span className="tc-bgyear" aria-hidden="true">{r.y}</span><div className="tc-mk"><span className="tc-ypill mono">{r.y}</span><span className="tc-yn">{r.n} event{r.n === 1 ? '' : 's'}</span></div></div>;
            if (r.t === 'today') return <div key="today" data-k="today" className={'tc-today' + rv}><div className="tc-mk"><span className="pill"><i></i>Today · {fmtDate(AJ.TODAY)}</span><span className="tc-yn">Expected milestones below</span></div></div>;
            if (r.t === 'fork') return (
              <div key={r.k} data-k={r.k} data-fork={r.L.id} data-side={r.side} className={`tc-item tc-forkrow side-${r.side}${rv}${dim(r.L.id) ? ' dim' : ''}`}>
                <div className="tc-fork" style={{ '--lc': r.L.c }}>
                  <span className="tc-fk-ic"><Icon name="merge" size={14} /></span>
                  <span className="tc-fk-m"><span className="tc-fk-t">New branch · <b>{r.L.full}</b></span><span className="tc-fk-s">Forked from {B.by[r.L.from].label} · {r.L.why}</span></span>
                  <span className="tc-fk-n mono">{r.n}<em>events</em></span>
                </div>
              </div>
            );
            if (r.t === 'end') return (
              <div key={r.k} data-k={r.k} data-endl={r.L.id} data-side={r.side} className={`tc-item tc-endrow side-${r.side}${rv}${dim(r.L.id) ? ' dim' : ''}`}>
                <div className="tc-fork end" style={{ '--lc': r.L.c }}><span className="tc-fk-ic"><Icon name="x" size={13} /></span><span className="tc-fk-m"><span className="tc-fk-t">Branch closed · <b>{r.L.label}</b></span><span className="tc-fk-s">{r.L.ended} {fmtMonth(r.e.date)} · {r.e.title}</span></span></div>
              </div>
            );
            const e = r.e;
            return (
              <article key={r.k} data-i={r.i} data-k={r.k} data-side={r.side} data-lane={r.ln} data-sig={e.significance} data-up={e.is_milestone ? '1' : '0'} data-note={e.user ? NOTE_TAGS[e.user.tag] : undefined}
                className={`tc-item side-${r.side} sg-${e.significance}${e.is_milestone ? ' up' : ''}${rv}${cur && cur.id === e.id ? ' act' : ''}${dim(r.ln) ? ' dim' : ''}`}>
                <TreeCard e={e} lane={B.multi ? B.by[r.ln] : null} open={openT.has(e.id)} onToggle={() => toggleT(e.id)} onJump={jump} pool={events} starred={ns.stars.includes(e.id)} nComments={(ns.comments[e.id] || []).length} onDetails={() => openDetail(e.id)} />
              </article>
            );
          })}
          <div className="tc-end"><div className="tc-mk"><span className="tc-seed end"><Icon name="flag" size={13} /></span><span>{list.some((e) => e.is_milestone) ? 'Projected milestones are dashed' : 'End of the recorded journey'}</span></div></div>
        </div>
        )}
        {cur && <div className="tc-hud"><span className="mono"><b>{cur.date.slice(0, 4)}</b></span>{B.multi && curLane && <span className="ln-chip sm" style={{ color: curLane.c, background: curLane.c + '14', borderColor: curLane.c + '40' }}><i style={{ background: curLane.c }}></i>{curLane.label}</span>}<span className="mono muted">{String(active + 1).padStart(2, '0')}/{String(list.length).padStart(2, '0')}</span><span className="tc-prog"><i style={{ width: `${((active + 1) / list.length) * 100}%` }}></i></span></div>}
        {detailE && <EventDetail e={detailE} list={sortedAll} onClose={() => setDetail(null)} onNav={(id) => { setDetail(id); jump(id); }} onLocate={(id) => jump(id)} />}
        {composer && <NoteComposer asset={assetId} lanes={B.multi ? B.list : [{ id: B.list[0].id, label: 'Journey' }]} init={composer} pool={events} onClose={() => setComposer(null)} onJump={(id) => { jump(id); setDetail(id); }} onAdded={(id) => { setComposer(null); setTimeout(() => { jump(id); setDetail(id); }, 350); }} />}
      </section>
    </div>
  );
}

Object.assign(window, { JourneyStory });
