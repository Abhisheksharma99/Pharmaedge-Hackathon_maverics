const { useState: hzS, useEffect: hzE, useRef: hzR, useLayoutEffect: hzLE } = React;

const HZ = { COL: 178, CW: 304, PADL: 236, ROW: 34, CA: 196, RUL: 30 };

function HorizontalTrack({ list, B, laneOf, scrollRef, onOpen, focusId, active, setActive, stars, comments, onAdd }) {
  const outerRef = hzR(null), trackRef = hzR(null), bgRef = hzR(null), pinRef = hzR(null);
  const [vw, setVw] = hzS(1000), [vh, setVh] = hzS(700), [p, setP] = hzS(0), [seen, setSeen] = hzS(-1);
  const rowsOrd = [...B.list].sort((a, z) => a.off - z.off);
  const rowOf = Object.fromEntries(rowsOrd.map((l, i) => [l.id, i]));
  const nR = rowsOrd.length;
  const H = HZ.RUL + HZ.CA + 14 + nR * HZ.ROW + 14 + HZ.CA;
  const top0 = Math.max(0, (vh - H) / 2);
  const bandTop = top0 + HZ.RUL + HZ.CA + 14, bandBot = bandTop + nR * HZ.ROW;
  const ly = (id) => bandTop + rowOf[id] * HZ.ROW + HZ.ROW / 2;
  const xs = list.map((_, i) => HZ.PADL + i * HZ.COL);
  const TW = (xs[xs.length - 1] || HZ.PADL) + HZ.CW / 2 + 140;
  const maxP = Math.max(0, TW - vw);
  const firstUp = list.findIndex((e) => e.is_milestone);
  const todayX = firstUp > 0 ? (xs[firstUp - 1] + xs[firstUp]) / 2 : firstUp === 0 ? HZ.PADL - 60 : (xs[xs.length - 1] || 0) + 70;
  const lanes = rowsOrd.map((l) => {
    const idx = list.map((e, i) => (laneOf(e) === l.id ? i : -1)).filter((i) => i >= 0);
    if (!idx.length && !l.trunk) return null;
    const x1 = l.trunk ? HZ.PADL - 110 : xs[idx[0]] - 74, x2 = l.ended && idx.length ? xs[idx[idx.length - 1]] + 26 : TW - 70;
    return { ...l, x1, x2, y: ly(l.id), py: l.trunk ? null : ly(l.from && rowOf[l.from] !== undefined ? l.from : rowsOrd.find((r) => r.trunk).id), first: idx.length ? list[idx[0]] : null };
  }).filter(Boolean);
  const years = []; list.forEach((e, i) => { const y = e.date.slice(0, 4); if (!years.length || years[years.length - 1].y !== y) years.push({ y, x: xs[i] }); });

  hzLE(() => {
    const sc = scrollRef.current; if (!sc || !pinRef.current) return;
    const m = () => { setVw(pinRef.current.clientWidth); setVh(sc.clientHeight); };
    m(); const ro = new ResizeObserver(m); ro.observe(sc); ro.observe(pinRef.current); return () => ro.disconnect();
  }, []);
  hzE(() => {
    const sc = scrollRef.current, outer = outerRef.current; if (!sc || !outer) return;
    let raf = 0;
    const upd = () => {
      const t = outer.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      const pp = Math.min(maxP, Math.max(0, -t));
      if (trackRef.current) trackRef.current.style.transform = `translateX(${-pp}px)`;
      if (bgRef.current) bgRef.current.style.transform = `translateX(${-pp * 0.55}px)`;
      setP(pp);
      const c = pp + vw * 0.5;
      let best = 0, bd = Infinity; xs.forEach((x, i) => { const d = Math.abs(x - c); if (d < bd) { bd = d; best = i; } });
      setActive(best);
      let mx = -1; xs.forEach((x, i) => { if (x - pp < vw - 40) mx = i; });
      setSeen((s) => Math.max(s, mx));
    };
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(upd); };
    sc.addEventListener('scroll', on, { passive: true }); upd();
    return () => { sc.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, [list, vw, vh, maxP]);
  const goTo = (i) => {
    const sc = scrollRef.current, outer = outerRef.current; if (!sc || !outer || i < 0 || i >= list.length) return;
    const t = outer.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTo({ top: t + Math.min(maxP, Math.max(0, xs[i] - vw / 2)), behavior: 'smooth' });
  };
  hzE(() => { if (focusId) { const i = list.findIndex((e) => e.id === focusId); if (i >= 0) setTimeout(() => goTo(i), 120); } }, [focusId, vw]);
  hzE(() => { window.__hzGo = (id) => goTo(list.findIndex((e) => e.id === id)); return () => { window.__hzGo = null; }; });

  const [hov, setHov] = hzS(null);
  const posAt = (ev) => {
    const r = ev.currentTarget.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const row = Math.min(nR - 1, Math.max(0, Math.floor((y - bandTop) / HZ.ROW)));
    let i = xs.findIndex((xx) => xx > x); if (i < 0) i = xs.length;
    const a = list[Math.max(0, i - 1)], b = list[Math.min(list.length - 1, i)];
    const fa = a ? yfrac(a.date) : 2000, fb = b ? yfrac(b.date) : fa + 1, xa = xs[Math.max(0, i - 1)] || 0, xb = xs[Math.min(list.length - 1, i)] || xa + 1;
    const f = xb === xa || x <= xa ? fa : fa + ((x - xa) / (xb - xa)) * (fb - fa), yy = Math.floor(f), mf = (f - yy) * 12, mm = Math.min(12, Math.max(1, Math.floor(mf) + 1)), dd = Math.min(28, Math.max(1, Math.round((mf - (mm - 1)) * 28) + 1));
    return { x, ly: ly(rowsOrd[row].id), lane: rowsOrd[row].id, date: `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, prev: i > 0 ? list[i - 1] : null, next: i < list.length ? list[i] : null, inBand: y >= bandTop - 6 && y <= bandBot + 6 };
  };
  const bandMove = (ev) => { const q = posAt(ev); setHov(q.inBand ? q : null); };
  const bandClick = (ev) => { const q = posAt(ev); if (q.inBand) onAdd({ date: q.date, lane: q.lane, prev: q.prev && q.prev.title, next: q.next && q.next.title }); };

  return (
    <div className="hz-outer" ref={outerRef} style={{ height: maxP + vh }}>
      <div className="hz-pin" ref={pinRef} style={{ height: vh }}>
        <div className="hz-bg" ref={bgRef} aria-hidden="true">{years.reduce((acc, y) => { const bx = y.x * 0.55; if (!acc.length || bx - acc[acc.length - 1].bx >= 520) acc.push({ ...y, bx }); return acc; }, []).map((y) => <span key={y.y} style={{ left: y.bx + vw * 0.3, top: bandTop - 70 }}>{y.y}</span>)}</div>
        <div className="hz-track" ref={trackRef} style={{ width: TW }}>
          <svg className="hz-svg" width={TW} height={vh} onClick={bandClick} onMouseMove={bandMove} onMouseLeave={() => setHov(null)}>
            <rect x={0} y={bandTop - 6} width={TW} height={nR * HZ.ROW + 12} fill="transparent" className="hz-band" />
            {years.map((y) => <g key={y.y}><line x1={y.x - HZ.COL / 2 + 6} x2={y.x - HZ.COL / 2 + 6} y1={top0 + 6} y2={bandBot + 8} className="hz-ytick" /><text x={y.x - HZ.COL / 2 + 12} y={top0 + 20} className="hz-ylab">{y.y}</text></g>)}
            <line x1={todayX} x2={todayX} y1={bandTop - 16} y2={bandBot + 16} className="tc-todayln" />
            <text x={todayX} y={bandTop - 22} textAnchor="middle" className="ft-today">Today</text>
            {lanes.map((l) => {
              const sol = Math.min(l.x2, todayX);
              return (
                <g key={l.id}>
                  {l.py != null && <path d={`M${l.x1 - 64},${l.py} C${l.x1 - 30},${l.py} ${l.x1 - 34},${l.y} ${l.x1},${l.y}`} stroke={l.c} className="tc-fk" />}
                  <line x1={l.x1} x2={sol} y1={l.y} y2={l.y} stroke={l.c} className={'tc-ln' + (l.trunk ? ' trunk' : '')} />
                  {l.x2 > todayX && !l.ended && <line x1={Math.max(l.x1, todayX)} x2={l.x2} y1={l.y} y2={l.y} stroke={l.c} className={'tc-ln fut' + (l.trunk ? ' trunk' : '')} />}
                  {!l.trunk && <g transform={`translate(${l.x1 + 6},${l.y - 9})`}><rect width={l.label.length * 6.6 + 14} height="18" rx="9" fill="#fff" stroke={l.c} /><text x="7" y="12.5" className="hz-inl" fill={l.c}>{l.label}</text></g>}
                  {l.ended && <g transform={`translate(${l.x2},${l.y})`}><circle r="8" fill="#fff" stroke={l.c} strokeWidth="2" /><path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2" stroke={l.c} strokeWidth="2" strokeLinecap="round" /></g>}
                </g>
              );
            })}
            {list.map((e, i) => {
              const L = B.by[laneOf(e)], y = ly(L.id), up = i % 2 === 0, on = i === active, rv = i <= seen;
              const span = AJ.SPAN[e.id] && B.multi ? AJ.SPAN[e.id].filter((s) => B.by[s]).map(ly) : null;
              return (
                <g key={e.id} className={'hz-n' + (rv ? ' in' : '') + (on ? ' act' : '') + (e.user ? ' note' : '')}>
                  <line x1={xs[i]} x2={xs[i]} y1={up ? bandTop - 14 : y} y2={up ? y : bandBot + 14} stroke={L.c} className="hz-cn" />
                  {span && <line x1={xs[i]} x2={xs[i]} y1={Math.min(...span)} y2={Math.max(...span)} stroke={L.c} className="tc-span" />}
                  {span && span.filter((sy) => sy !== y).map((sy) => <circle key={sy} cx={xs[i]} cy={sy} r="3.5" fill="#fff" stroke={L.c} strokeWidth="2" />)}
                  <circle cx={xs[i]} cy={y} r={on ? 8 : e.significance === 'High' ? 6.5 : 5} fill={e.is_milestone || e.user ? '#fff' : L.c} stroke={e.user ? NOTE_TAGS[e.user.tag] : e.is_milestone ? L.c : '#fff'} strokeWidth="2.5" strokeDasharray={e.is_milestone ? '2.5 2' : undefined} className="hz-dot" />
                </g>
              );
            })}
            {hov && <g className="hz-hov" pointerEvents="none"><line x1={hov.x} x2={hov.x} y1={bandTop - 10} y2={bandBot + 10} /><circle cx={hov.x} cy={hov.ly} r="9" style={{ stroke: B.by[hov.lane].c }} /><path d={`M${hov.x - 4},${hov.ly} h8 M${hov.x},${hov.ly - 4} v8`} style={{ stroke: B.by[hov.lane].c }} /></g>}
          </svg>
          {hov && <div className="add-pill" style={{ left: hov.x, top: hov.ly - 42, '--lc': B.by[hov.lane].c }}><Icon name="plus" size={12} /><b>{fmtDate(hov.date)}</b>{B.multi && <span>· {B.by[hov.lane].label}</span>}<em>Click to add a note</em></div>}
          {list.map((e, i) => {
            const up = i % 2 === 0, m = AJ.CAT[e.category], L = B.by[laneOf(e)], rv = i <= seen;
            const style = { left: xs[i] - HZ.CW / 2, width: HZ.CW, ...(up ? { bottom: vh - (bandTop - 14) } : { top: bandBot + 14 }), '--dl': `${(i % 3) * 60}ms` };
            const nc = (comments[e.id] || []).length;
            return (
              <button key={e.id} type="button" className={`hz-card ${up ? 'up' : 'dn'}${rv ? ' in' : ''}${i === active ? ' act' : ''}${e.is_milestone ? ' ms' : ''}${e.user ? ' note' : ''} sg-${e.significance}`} style={style} onClick={() => onOpen(e.id)}>
                <span className="hz-meta"><CatIcon cat={e.category} size={22} /><span className="mono">{e.is_milestone ? `Exp. ${fmtMonth(e.date)}` : fmtDate(e.date)}</span>{stars.includes(e.id) && <Icon name="star" size={12} className="star-on" />}{nc > 0 && <span className="hz-cm"><Icon name="msg" size={11} />{nc}</span>}<span className="sp"></span><Sig v={e.significance} /></span>
                <span className="hz-title">{e.title}</span>
                <span className="hz-tg">
                  {e.user && <span className="nt-tag" style={{ '--tc': NOTE_TAGS[e.user.tag] }}>{e.user.tag}</span>}
                  {B.multi && <span className="ln-chip sm" style={{ color: L.c, background: L.c + '14', borderColor: L.c + '40' }}><i style={{ background: L.c }}></i>{L.label}</span>}
                  {e.ind.slice(0, 2).map((x) => <span key={x} className="ind sm" style={{ background: m.soft, color: m.c }}>{x}</span>)}
                  {e.product && <span className="prod sm">{e.product}</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="hz-labels" style={{ top: bandTop, height: nR * HZ.ROW }}>
          {rowsOrd.map((l) => {
            const ln = lanes.find((x) => x.id === l.id), started = ln && (l.trunk || ln.x1 <= p + vw * 0.75);
            return <div key={l.id} className={'hz-lab' + (started ? ' on' : '') + (ln ? '' : ' none')} style={{ height: HZ.ROW, '--lc': l.c }}><i></i><b>{l.label || 'Journey'}</b><span>{!ln ? 'no events' : started ? (l.trunk ? 'trunk' : l.ended ? 'closed' : l.status.split(' · ')[0]) : `from ${ln.first.date.slice(0, 4)}`}</span></div>;
          })}
        </div>
        <button className="hz-arrow l" aria-label="Previous event" onClick={() => goTo(active - 1)} disabled={active <= 0}><Icon name="chevL" size={18} /></button>
        <button className="hz-arrow r" aria-label="Next event" onClick={() => goTo(active + 1)} disabled={active >= list.length - 1}><Icon name="chevR" size={18} /></button>
        <div className="hz-hint"><Icon name="plus" size={12} />Hover a branch to see the date · click to add a note there</div>
      </div>
    </div>
  );
}

Object.assign(window, { HorizontalTrack });
