const { useState: tS, useRef: tR, useEffect: tE, useMemo: tM, useCallback: tC } = React;

function KpiStrip({ items: given }) {
  const ev = AJ.EVENTS;
  const items = given || [
    ['landmark', 'Approved in', AJ.ASSET.approvalRegions.join(', '), 'FDA and EMA authorisations'],
    ['flask', 'Active trials', '9', '3 in Phase 3'],
    ['calendar', 'Upcoming milestones', String(ev.filter((e) => e.is_milestone).length), 'Trial readouts, decisions and patent expiries'],
    ['route', 'Journey events', String(ev.length), 'Regulatory, clinical, patent and company history'],
    ['megaphone', 'Company releases', '112', AJ.ASSET.company],
  ];
  return <section className="kpis" aria-label="Key metrics">{items.map(([ic, l, v, h], i) => (
    <div key={l} className="kpi" style={{ animationDelay: `${i * 60}ms` }}><div className="kpi-l"><Icon name={ic} size={16} />{l}</div><div className="kpi-v">{v}</div><div className="kpi-h">{h}</div></div>
  ))}</section>;
}

function JourneyMap({ events, shown, win, onJump, hl, setHl }) {
  const ref = tR(null);
  const w = useWidth(ref);
  const cats = Object.keys(AJ.CAT);
  const W = Math.max(w, 320), L = 92, R = 12, laneH = 14, top = 4, H = top + cats.length * laneH + 20;
  const x = (y) => L + ((y - AJ.Y0) / (AJ.Y1 - AJ.Y0)) * (W - L - R);
  const tx = x(yfrac(AJ.TODAY));
  const step = W < 640 ? 4 : 2;
  const years = []; for (let y = AJ.Y0; y <= AJ.Y1; y += step) years.push(y);
  const click = (ev) => {
    const r = ref.current.getBoundingClientRect();
    const y = AJ.Y0 + ((ev.clientX - r.left - L) / (W - L - R)) * (AJ.Y1 - AJ.Y0);
    onJump({ year: Math.floor(y) });
  };
  const hv = hl && events.find((e) => e.id === hl);
  return (
    <div className="jx-map">
      <div className="jx-map-l"><span>Journey map</span><em>click to jump · window shows what’s on screen</em></div>
      <div className="jx-map-in" ref={ref}>
      <svg width={W} height={H} onClick={click} className="jx-map-svg">
        {cats.map((c, i) => <g key={c}><rect x={L} y={top + i * laneH} width={W - L - R} height={laneH} fill={i % 2 ? '#fff' : '#fafbfc'} /><text x={0} y={top + i * laneH + laneH - 3.5} className="jx-map-lane">{AJ.CAT[c].label}</text></g>)}
        {years.map((y) => <line key={y} x1={x(y)} x2={x(y)} y1={top} y2={top + cats.length * laneH} stroke="#eef0f3" />)}
        <line x1={tx} x2={tx} y1={top - 2} y2={top + cats.length * laneH + 2} stroke="#101828" strokeDasharray="2 2" />
        {events.map((e) => {
          const on = shown.has(e.id), c = AJ.CAT[e.category].c, cy = top + cats.indexOf(e.category) * laneH + laneH / 2;
          const r = e.significance === 'High' ? 4 : e.significance === 'Medium' ? 3.2 : 2.4;
          return <circle key={e.id} cx={x(yfrac(e.date))} cy={cy} r={hl === e.id ? r + 2 : r} fill={e.is_milestone ? '#fff' : c} stroke={c} strokeWidth={e.is_milestone ? 1.3 : 0} opacity={on ? 1 : 0.18} className="jx-map-dot"
            onMouseEnter={() => on && setHl(e.id)} onMouseLeave={() => setHl(null)} onClick={(ev) => { ev.stopPropagation(); on && onJump({ id: e.id }); }} />;
        })}
        {years.map((y) => <text key={y} x={x(y)} y={H - 4} textAnchor="middle" className="ft-yr">{y}</text>)}
      </svg>
      {win[0] != null && <div className="jx-win" style={{ left: x(win[0]) - 6, width: Math.max(12, x(win[1]) - x(win[0]) + 12), top: top - 3 + 0, height: cats.length * laneH + 6 }}></div>}
      {hv && <div className="tip" style={{ left: x(yfrac(hv.date)), top: top + cats.indexOf(hv.category) * laneH }}><b>{hv.title}</b><span>{fmtDate(hv.date)}</span></div>}
      </div>
    </div>
  );
}

function EventCard({ e, hl, setHl, onOpen }) {
  const up = e.is_milestone, m = AJ.CAT[e.category];
  const chips = [e.region, e.phase, e.nct_id].filter(Boolean);
  if (e.significance === 'Low') {
    return (
      <button type="button" className={'jx-card lo' + (hl ? ' hl' : '')} onClick={onOpen} onMouseEnter={() => setHl(e.id)} onMouseLeave={() => setHl(null)}>
        <span className="mono jx-d">{fmtDate(e.date)}</span><span className="jx-title-s">{e.title}</span><span className={'via via-' + e.via}>{viaLabel(e)}</span>
      </button>
    );
  }
  return (
    <button type="button" className={'jx-card s-' + e.significance + (up ? ' up' : '') + (hl ? ' hl' : '')} onClick={onOpen} onMouseEnter={() => setHl(e.id)} onMouseLeave={() => setHl(null)}>
      <div className="jx-meta">
        <span className="mono jx-d">{up ? `Expected ${fmtMonth(e.date)}` : fmtDate(e.date)}</span>
        {up && <span className="jx-cd"><Icon name="clock" size={11} />{relFuture(e.date)}</span>}
        <span className="jx-cat" style={{ color: m.c }}>{m.label}</span>
      </div>
      <div className="jx-title">{e.title}</div>
      {e.summary && <p className="jx-sum">{e.summary}</p>}
      <div className="jx-foot">
        {chips.map((c) => <span key={c} className="tag mono">{c}</span>)}
        <span className={'via via-' + e.via}>{e.via === 'ai_events' && <Icon name="sparkles" size={11} />}{viaLabel(e)}</span>
        <span className="sp"></span><Sig v={e.significance} />
      </div>
    </button>
  );
}

function EventSheet({ e, list, onClose, onNav }) {
  const idx = list.findIndex((x) => x.id === e.id);
  const prev = list[idx - 1], next = list[idx + 1];
  tE(() => {
    const k = (ev) => { if (ev.key === 'Escape') onClose(); if (ev.key === 'ArrowLeft' && prev) onNav(prev.id); if (ev.key === 'ArrowRight' && next) onNav(next.id); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [e.id]);
  const m = AJ.CAT[e.category];
  const how = e.via === 'ai_events' ? { t: `Extracted and consolidated by AI from ${e.sources.length} record${e.sources.length > 1 ? 's' : ''}`, s: 'Step: AI event extraction and consolidation' }
    : e.via === 'finalize' ? { t: 'Added when the journey was rebuilt with patents and the FDA calendar', s: 'Step: Finalize' }
      : { t: `Mapped by rule from a dated ${e.sources[0].collection.replace('_', ' ')} entry`, s: `Rule: ${e.type}` };
  return ReactDOM.createPortal(
    <>
      <div className="sheet-ov" onClick={onClose}></div>
      <aside className="sheet" role="dialog" aria-label={e.title}>
        <div className="sh-h">
          <div className="sh-cat"><CatIcon cat={e.category} size={28} /><span>{m.label}</span>{e.is_milestone && <span className="jx-cd"><Icon name="clock" size={11} />{relFuture(e.date)}</span>}</div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="sh-b" key={e.id}>
          <h2>{e.title}</h2>
          <div className="sh-facts">
            <span className="mono">{e.is_milestone ? `Expected ${fmtDate(e.date)}` : fmtDate(e.date)}</span>
            {[e.region, e.phase, e.nct_id].filter(Boolean).map((c) => <span key={c} className="tag mono">{c}</span>)}
            <Sig v={e.significance} />
          </div>
          {e.summary && <p className="sh-sum">{e.summary}</p>}
          <div className="sh-how">
            <div className="sh-lbl">How this event was built</div>
            <div className="sh-flow">
              <div className="sh-recs">{e.sources.slice(0, 4).map((s, i) => <span key={s.record_key} className="sh-rec" style={{ '--c': AJ.COLL[s.collection].c, animationDelay: `${i * 70}ms` }}>{s.collection}</span>)}{e.sources.length > 4 && <span className="sh-rec more">+{e.sources.length - 4}</span>}</div>
              <span className="sh-arrow"><Icon name={e.via === 'ai_events' ? 'merge' : 'arrowR'} size={14} /></span>
              <span className="sh-out" style={{ background: m.soft, color: m.c }}><Icon name={m.icon} size={13} />Event</span>
            </div>
            <p>{how.t}</p><p className="mono sh-rule">{how.s}</p>
          </div>
          <div className="sh-lbl">Evidence</div>
          <ul className="sh-src">{e.sources.map((s) => (
            <li key={s.record_key}><span className="dot" style={{ background: AJ.COLL[s.collection].c }}></span><div><div className="mono k">{s.record_key}</div><div className="c">{s.collection} · {AJ.COLL[s.collection].tab} tab</div></div><a href="#" onClick={(ev) => ev.preventDefault()}>Open record <Icon name="arrowUR" size={12} /></a></li>
          ))}</ul>
        </div>
        <div className="sh-f">
          <button className="btn btn-sm" disabled={!prev} onClick={() => prev && onNav(prev.id)}><Icon name="chevL" size={14} />{prev ? <span className="trunc">{prev.title}</span> : 'Previous'}</button>
          <button className="btn btn-sm" disabled={!next} onClick={() => next && onNav(next.id)}>{next ? <span className="trunc">{next.title}</span> : 'Next'}<Icon name="chevR" size={14} /></button>
        </div>
      </aside>
    </>,
    document.body
  );
}

function JourneyExplorer({ reveal, layout, scrollRef, onShowBuild, events = AJ.EVENTS, kpis, onOpenRecord }) {
  const [scope, setScope] = tS('key');
  const [cats, setCats] = tS([]);
  const [companyOnly, setCompanyOnly] = tS(true);
  const [order, setOrder] = tS('asc');
  const [sel, setSel] = tS(null);
  const [hl, setHl] = tS(null);
  const [flash, setFlash] = tS(null);
  const [activeYear, setActiveYear] = tS(null);
  const [win, setWin] = tS([null, null]);
  const [revealed, setRevealed] = tS(() => new Set());
  const listRef = tR(null), fillRef = tR(null);

  const scoped = tM(() => events.filter((e) => (scope === 'all' || e.significance !== 'Low') && (!companyOnly || e.sponsor_is_company !== false)), [scope, companyOnly, events]);
  const list = tM(() => scoped.filter((e) => !cats.length || cats.includes(e.category)).sort((a, z) => (order === 'asc' ? 1 : -1) * a.date.localeCompare(z.date)), [scoped, cats, order]);
  const shown = tM(() => new Set(list.map((e) => e.id)), [list]);

  const rows = tM(() => {
    const out = []; let yr = null, todayDone = false;
    const yc = {}; list.forEach((e) => { const y = e.date.slice(0, 4); yc[y] = (yc[y] || 0) + 1; });
    const upN = list.filter((e) => e.is_milestone).length;
    list.forEach((e) => {
      const y = e.date.slice(0, 4);
      const crossing = !todayDone && (order === 'asc' ? e.is_milestone : !e.is_milestone);
      if (crossing && upN) { out.push({ k: 'today', t: 'today', up: upN }); todayDone = true; }
      if (y !== yr) { out.push({ k: 'y' + y, t: 'year', y, n: yc[y], future: e.is_milestone }); yr = y; }
      out.push({ k: e.id, t: 'ev', e });
    });
    if (!todayDone && upN && order === 'desc') out.push({ k: 'today', t: 'today', up: upN });
    return out;
  }, [list, order]);

  // Scroll-linked spine fill, active year and visible window.
  tE(() => {
    const sc = scrollRef.current; if (!sc) return;
    let raf = 0;
    const update = () => {
      const el = listRef.current; if (!el) return;
      const sr = sc.getBoundingClientRect(), lr = el.getBoundingClientRect();
      const probe = sr.top + sr.height * 0.45;
      const p = Math.min(1, Math.max(0, (probe - lr.top) / Math.max(1, lr.height)));
      if (fillRef.current) fillRef.current.style.height = p * 100 + '%';
      let ay = null;
      for (const y of el.querySelectorAll('[data-yr]')) { if (y.getBoundingClientRect().top <= probe) ay = y.dataset.yr; else break; }
      const first = el.querySelector('[data-yr]');
      setActiveYear(ay || (first && first.dataset.yr) || null);
      let mn = Infinity, mx = -Infinity;
      el.querySelectorAll('[data-y]').forEach((it) => { const r = it.getBoundingClientRect(); if (r.bottom > sr.top + 150 && r.top < sr.bottom) { const v = +it.dataset.y; mn = Math.min(mn, v); mx = Math.max(mx, v); } });
      setWin(mn <= mx ? [mn, mx] : [null, null]);
    };
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    sc.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on);
    update();
    return () => { sc.removeEventListener('scroll', on); window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, [rows, scrollRef]);

  // Scroll reveal: rows fade in as they enter the viewport, staggered per batch.
  tE(() => {
    const sc = scrollRef.current, el = listRef.current; if (!sc || !el) return;
    if (reveal === 'off' || REDUCED) { setRevealed(new Set(rows.map((r) => r.k))); return; }
    const io = new IntersectionObserver((entries) => {
      const ins = entries.filter((en) => en.isIntersecting && !en.target.classList.contains('in'));
      if (!ins.length) return;
      ins.forEach((en, i) => { en.target.style.transitionDelay = `${Math.min(i, 7) * 70}ms`; io.unobserve(en.target); });
      setRevealed((prev) => { const n = new Set(prev); ins.forEach((en) => n.add(en.target.dataset.k)); return n; });
    }, { root: sc, rootMargin: '0px 0px -6% 0px', threshold: 0.1 });
    // Rows already on screen reveal immediately (staggered); the rest as they scroll in.
    const sr = sc.getBoundingClientRect(), now = [];
    el.querySelectorAll('[data-k]').forEach((r) => {
      if (revealed.has(r.dataset.k)) return;
      const b = r.getBoundingClientRect();
      if (b.top < sr.bottom && b.bottom > sr.top) { r.style.transitionDelay = `${Math.min(now.length, 7) * 70}ms`; now.push(r.dataset.k); } else io.observe(r);
    });
    if (now.length) setRevealed((prev) => { const n = new Set(prev); now.forEach((k) => n.add(k)); return n; });
    return () => io.disconnect();
  }, [rows, reveal]);

  const jump = tC(({ year, id }) => {
    const sc = scrollRef.current, el = listRef.current; if (!sc || !el) return;
    let target = null;
    if (id) { target = el.querySelector(`[data-k="${id}"]`); setFlash(id); setTimeout(() => setFlash(null), 1600); }
    else {
      const ys = [...el.querySelectorAll('[data-yr]')];
      target = ys.reduce((best, n) => (!best || Math.abs(+n.dataset.yr - year) < Math.abs(+best.dataset.yr - year) ? n : best), null);
    }
    if (target) sc.scrollTo({ top: target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 170, behavior: 'smooth' });
  }, [scrollRef]);

  const toggleCat = (c) => setCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const yearEvents = list.filter((e) => e.date.slice(0, 4) === activeYear);
  const selE = sel && events.find((e) => e.id === sel);
  const alt = layout === 'alternate';
  let side = 0;

  return (
    <div className="jx">
      <KpiStrip items={kpis} />
      <section className="panel jx-panel" data-reveal={reveal}>
        <div className="panel-h">
          <div className="panel-t"><h3>Journey</h3><p>Dated events from regulatory, clinical and company sources. Select an event to see its evidence.</p></div>
          <div className="jx-acts">
            {onShowBuild && <button className="btn btn-sm btn-ghost" onClick={onShowBuild}><Icon name="activity" size={14} />How this journey was built</button>}
            <Seg label="Order" value={order} onChange={setOrder} options={[{ value: 'asc', label: 'Oldest first' }, { value: 'desc', label: 'Newest first' }]} />
            <Seg label="Events shown" value={scope} onChange={setScope} options={[{ value: 'key', label: 'Key events' }, { value: 'all', label: 'All' }]} />
          </div>
        </div>
        <div className="jx-filters">
          {Object.entries(AJ.CAT).map(([c, m]) => {
            const n = scoped.filter((e) => e.category === c).length;
            return <button key={c} type="button" aria-pressed={cats.includes(c)} className={'fchip' + (cats.includes(c) ? ' on' : '')} onClick={() => toggleCat(c)}><i className="dot" style={{ background: m.c }}></i>{m.label}<span className="n mono">{n}</span></button>;
          })}
          {cats.length > 0 && <button className="clear" onClick={() => setCats([])}>Clear</button>}
          <span className="sp"></span>
          <Switch on={companyOnly} onChange={setCompanyOnly} label="Company-sponsored trials only" />
        </div>
        <JourneyMap events={events} shown={shown} win={win} onJump={jump} hl={hl} setHl={setHl} />

        {list.length === 0 ? (
          <div className="empty"><p className="t">No events match these filters</p><p>Try another category or show all events.</p></div>
        ) : (
          <div className={'jx-body' + (alt ? ' alt' : '')}>
            <aside className="jx-rail" aria-hidden="true">
              {activeYear && <>
                <div className="jx-rail-y" key={activeYear}>{activeYear}</div>
                <div className="jx-rail-n">{yearEvents.length} event{yearEvents.length === 1 ? '' : 's'}{+activeYear > 2026 || yearEvents.every((e) => e.is_milestone) ? ' expected' : ''}</div>
                <div className="jx-rail-c">{yearEvents.map((e) => <i key={e.id} title={e.title} style={{ background: AJ.CAT[e.category].c }}></i>)}</div>
              </>}
            </aside>
            <div className="jx-track">
            <div className="jx-spine"><i ref={fillRef}></i></div>
            <ol className="jx-list" ref={listRef}>
              {rows.map((r) => {
                const rv = 'rv' + (revealed.has(r.k) ? ' in' : '');
                if (r.t === 'year') return <li key={r.k} data-k={r.k} data-yr={r.y} className={'jx-yr ' + rv + (r.future ? ' fut' : '')}><span className="jx-yr-pill mono">{r.y}</span><span className="jx-yr-n">{r.n} event{r.n === 1 ? '' : 's'}</span></li>;
                if (r.t === 'today') return <li key={r.k} data-k={r.k} className={'jx-today ' + rv}><span className="pill"><i></i>Today · {fmtDate(AJ.TODAY)}</span><span className="txt">{r.up} upcoming milestone{r.up === 1 ? '' : 's'} {order === 'asc' ? 'below' : 'above'}</span></li>;
                const e = r.e, s = alt ? (side++ % 2 ? 'r' : 'l') : 'r';
                return (
                  <li key={r.k} data-k={r.k} data-y={yfrac(e.date)} className={`jx-item ${rv} side-${s} sg-${e.significance}${e.is_milestone ? ' up' : ''}${flash === e.id ? ' flash' : ''}`}>
                    <div className="jx-node"><span className="dot" style={{ background: e.is_milestone ? '#fff' : AJ.CAT[e.category].soft, color: AJ.CAT[e.category].c, borderColor: e.is_milestone ? AJ.CAT[e.category].c : '#fff' }}><Icon name={AJ.CAT[e.category].icon} size={e.significance === 'High' ? 15 : 13} /></span></div>
                    <i className="jx-conn"></i>
                    <div className="jx-cardwrap"><EventCard e={e} hl={hl === e.id} setHl={setHl} onOpen={() => setSel(e.id)} /></div>
                  </li>
                );
              })}
            </ol>
            </div>
          </div>
        )}
        <div className="jx-ft">Showing {list.length} of {events.length} events{scope === 'key' ? ' · low-significance events hidden' : ''}</div>
      </section>
      {selE && <EventSheet e={selE} list={list} onClose={() => setSel(null)} onNav={setSel} />}
    </div>
  );
}

Object.assign(window, { JourneyExplorer, EventSheet, KpiStrip });
