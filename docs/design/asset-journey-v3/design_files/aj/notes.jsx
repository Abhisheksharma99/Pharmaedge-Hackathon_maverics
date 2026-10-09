const { useState: nS, useEffect: nE, useRef: nR } = React;

// Per-user stars, comments and timeline notes (persisted locally).
const NOTE_KEY = 'aj.notes.v1';
const noteStore = (() => {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(NOTE_KEY)); } catch (e) {}
  if (!s) s = {
    stars: ['e36', 'e24'],
    comments: { e36: [{ by: 'Priya Shah', at: '2026-10-01T10:12:00', text: 'PDUFA lands mid-2027. Flag for the Q3 board pack.' }] },
    notes: [{ id: 'n-seed', asset: 'treprostinil', date: '2025-05-23', lane: 'PH-ILD', tag: 'Missed by AI', category: 'regulatory', title: 'FDA approves Yutrepia (Liquidia) for PAH and PH-ILD', text: 'Competitor dry-powder treprostinil approved after the ’793 patent was invalidated. Direct threat to Tyvaso DPI in both indications.', by: 'Alex Morgan', created: '2026-10-02T09:00:00', mode: 'ai', sources: [{ collection: 'fda_records', record_key: 'NDA213005-ORIG-1' }, { collection: 'articles', record_key: 'reuters-2025-05-23-liquidia' }] }],
  };
  const subs = new Set();
  return {
    get: () => s,
    set: (fn) => { s = fn(s); try { localStorage.setItem(NOTE_KEY, JSON.stringify(s)); } catch (e) {} subs.forEach((f) => f(s)); },
    sub: (f) => { subs.add(f); return () => subs.delete(f); },
  };
})();
function useNotes() {
  const [s, setS] = nS(noteStore.get());
  nE(() => noteStore.sub(setS), []);
  return [s, noteStore.set];
}
const NOTE_TAGS = { Important: '#b42318', 'Missed by AI': '#6941c6', Question: '#2347d9', Risk: '#b54708', Opportunity: '#0b7a6f' };

function noteToEvent(n) {
  const up = n.date > AJ.TODAY;
  return {
    id: n.id, asset: n.asset, date: n.date, category: n.category || 'company', type: 'user_note', significance: n.tag === 'Important' || n.tag === 'Risk' ? 'High' : 'Medium',
    title: n.title, summary: n.text, via: 'user', sources: n.sources || [], is_milestone: up, region: null, phase: null, nct_id: null, sponsor_is_company: null,
    user: n, ind: n.lane && n.lane !== 'main' ? [n.lane] : [], product: null, impact: null, links: n.linkTo ? [n.linkTo] : [],
    details: { Tag: n.tag, 'Added by': n.by, Added: n.created.slice(0, 10), Method: n.mode === 'ai' ? 'Found by Asset AI' : 'Added manually' },
  };
}
function toggleStar(id) { noteStore.set((s) => ({ ...s, stars: s.stars.includes(id) ? s.stars.filter((x) => x !== id) : [...s.stars, id] })); }
function addComment(id, text) { noteStore.set((s) => ({ ...s, comments: { ...s.comments, [id]: [...(s.comments[id] || []), { by: PE_USER().name, at: new Date().toISOString(), text }] } })); }
const PE_USER = () => (window.PE ? PE.USER : { name: 'Alex Morgan' });

// Simulated Asset AI lookup for something the user says happened.
function aiFind(text, ctx) {
  const s = text.toLowerCase();
  const pool = ctx.pool || [];
  return new Promise((res) => setTimeout(() => {
    if (/yutrepia|liquidia/.test(s)) return res({ kind: 'found', ev: { date: '2025-05-23', category: 'regulatory', lane: 'PH-ILD', title: 'FDA approves Yutrepia (Liquidia) for PAH and PH-ILD', text: 'Dry-powder inhaled treprostinil from Liquidia approved for PAH and PH-ILD; competes directly with Tyvaso DPI.', sources: [{ collection: 'fda_records', record_key: 'NDA213005-ORIG-1' }, { collection: 'articles', record_key: 'reuters-2025-05-23-liquidia' }, { collection: 'articles', record_key: 'fierce-2025-05-yutrepia' }] }, note: 'Found an FDA approval record and 2 news articles. It was filed under the competitor, so it wasn’t on this journey.' });
    const words = s.split(/[^a-z0-9-]+/).filter((w) => w.length > 3);
    let best = null, bs = 0;
    pool.forEach((e) => { const t = (e.title + ' ' + (e.summary || '')).toLowerCase(); const sc = words.filter((w) => t.includes(w)).length; if (sc > bs) { bs = sc; best = e; } });
    if (best && bs >= 2) return res({ kind: 'exists', ev: best, note: `This looks like an event already on the journey (${bs} matching terms).` });
    res({ kind: 'none', note: 'No dated FDA, EMA, trial, publication or news record matched. You can keep it as a note; it will be re-checked on the next refresh.' });
  }, 1700));
}

function NoteComposer({ asset, lanes, init, pool, onClose, onAdded, onJump }) {
  const [f, setF] = nS({ date: init.date || AJ.TODAY, lane: init.lane || lanes[0].id, tag: 'Missed by AI', category: 'regulatory', title: '', text: '' });
  const [phase, setPhase] = nS('edit');
  const [res, setRes] = nS(null);
  const [step, setStep] = nS(0);
  const ok = f.title.trim() || f.text.trim();
  const save = (ev, mode) => {
    const n = { id: 'n-' + Date.now(), asset, by: PE_USER().name, created: new Date().toISOString(), mode, ...f, ...(ev || {}), tag: f.tag, title: (ev && ev.title) || f.title || f.text.slice(0, 80), text: (ev && ev.text) || f.text };
    noteStore.set((s) => ({ ...s, notes: [...s.notes, n] }));
    onAdded(n.id);
  };
  const ask = () => {
    setPhase('search'); setStep(0);
    [400, 900, 1350].forEach((t, i) => setTimeout(() => setStep(i + 1), t));
    aiFind(`${f.title} ${f.text}`, { pool }).then((r) => { setRes(r); setPhase('result'); if (r.ev && r.kind === 'found') setF((x) => ({ ...x, date: r.ev.date, lane: lanes.some((l) => l.id === r.ev.lane) ? r.ev.lane : x.lane, category: r.ev.category })); });
  };
  nE(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return ReactDOM.createPortal(
    <div className="nc-ov" onMouseDown={onClose}>
      <div className="nc" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Add to the journey">
        <div className="nc-h"><span className="tile sm nc-ic"><Icon name="flag" size={14} /></span><div><b>Add to the journey</b><span>Mark something important, or tell Asset AI what it missed.</span></div><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button></div>
        <div className="nc-where" style={{ '--lc': (lanes.find((l) => l.id === f.lane) || {}).c || '#2347d9' }}><Icon name="calendar" size={14} /><b>{fmtDate(f.date)}</b>{lanes.length > 1 && <span className="ln-dot"><i></i>{(lanes.find((l) => l.id === f.lane) || {}).label}</span>}{init.prev || init.next ? <span className="nc-btw">{init.prev ? <>after “{init.prev}”</> : null}{init.prev && init.next ? ' · ' : ''}{init.next ? <>before “{init.next}”</> : null}</span> : null}</div>
        {phase === 'edit' && (
          <div className="nc-b">
            <label className="nc-f"><span>What happened?</span><input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Yutrepia approved by FDA" /></label>
            <label className="nc-f"><span>Context for Asset AI <em>(optional)</em></span><textarea rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Where you heard it, roughly when, who was involved…" /></label>
            <div className="nc-row">
              <label className="nc-f"><span>Date</span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
              {lanes.length > 1 && <label className="nc-f"><span>Branch</span><select value={f.lane} onChange={(e) => setF({ ...f, lane: e.target.value })}>{lanes.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>}
              <label className="nc-f"><span>Category</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(AJ.CAT).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></label>
            </div>
            <div className="nc-f"><span>Tag</span><div className="nc-tags">{Object.entries(NOTE_TAGS).map(([t, c]) => <button key={t} type="button" className={'nc-tag' + (f.tag === t ? ' on' : '')} style={{ '--tc': c }} onClick={() => setF({ ...f, tag: t })}>{t}</button>)}</div></div>
            <div className="nc-ft"><button className="btn btn-sm" disabled={!ok} onClick={() => save(null, 'manual')}>Add manually</button><span className="sp"></span><button className="btn btn-sm btn-p" disabled={!ok} onClick={ask}><Icon name="sparkles" size={14} />Ask Asset AI to find it</button></div>
          </div>
        )}
        {phase === 'search' && (
          <div className="nc-b nc-search">
            {['Reading your note', 'Searching FDA, EMA, ClinicalTrials.gov and PubMed', 'Searching news, press releases and competitor journeys'].map((t, i) => (
              <div key={t} className={'nc-st' + (step > i ? ' done' : step === i ? ' run' : '')}>{step > i ? <Icon name="check" size={13} sw={2.6} /> : step === i ? <Icon name="loader" size={13} className="spin" /> : <Icon name="dashed" size={13} />}{t}</div>
            ))}
          </div>
        )}
        {phase === 'result' && res && (
          <div className="nc-b">
            <p className={'nc-res k-' + res.kind}><Icon name={res.kind === 'none' ? 'alert' : 'sparkles'} size={14} />{res.note}</p>
            {res.kind === 'found' && (
              <div className="nc-prop">
                <div className="nc-pt"><CatIcon cat={res.ev.category} size={26} /><div><b>{res.ev.title}</b><span className="mono">{fmtDate(res.ev.date)} · {lanes.find((l) => l.id === f.lane)?.label}</span></div></div>
                <p>{res.ev.text}</p>
                <div className="nc-src">{res.ev.sources.map((s) => <span key={s.record_key} className="sh-rec" style={{ '--c': AJ.COLL[s.collection].c }}>{s.record_key}</span>)}</div>
              </div>
            )}
            {res.kind === 'exists' && <button className="wc-i nc-ex" onClick={() => { onClose(); onJump(res.ev.id); }}><CatIcon cat={res.ev.category} size={26} /><span className="wc-m"><span className="wc-t">{res.ev.title}</span><span className="wc-s mono">{fmtDate(res.ev.date)}</span></span><Icon name="arrowR" size={14} /></button>}
            <div className="nc-ft">
              <button className="btn btn-sm" onClick={() => setPhase('edit')}>Back</button><span className="sp"></span>
              {res.kind === 'found' && <button className="btn btn-sm btn-p" onClick={() => save(res.ev, 'ai')}><Icon name="plus" size={14} />Add to journey</button>}
              {res.kind !== 'found' && <button className="btn btn-sm btn-p" onClick={() => save(null, 'manual')}>Keep as a note</button>}
            </div>
          </div>
        )}
      </div>
    </div>, document.body);
}

Object.assign(window, { noteStore, useNotes, noteToEvent, toggleStar, addComment, NoteComposer, NOTE_TAGS });
