const { useState: rS, useMemo: rM } = React;

const ST_TONE = (s) => /complet|approv|authoris|granted|ingest|positive/i.test(s) ? 'ok' : /recruit|active|expected|enrolling/i.test(s) ? 'run' : /terminat|complete response|invalid|failed/i.test(s) ? 'bad' : /review|ongoing|headline|litigation|asserted/i.test(s) ? 'warn' : '';
const StBadge = ({ v }) => <span className={'jb jb-' + ST_TONE(v)}>{v}</span>;
const mono = (k) => (r) => <span className="mono nowrap">{r[k]}</span>;
const mutedDate = (k) => (r) => <span className="mono nowrap muted">{r[k] && r[k].length === 10 ? fmtDate(r[k]) : r[k]}</span>;

const REC_CFG = {
  clinical: { title: 'Clinical trials', desc: 'ClinicalTrials.gov studies with the asset as an intervention', step: 'clinical', total: (a) => a.trials, q: ['nct', 'name', 'title', 'sponsor', 'ind'], facets: [['phase', 'Phase'], ['status', 'Status'], ['ind', 'Indication']], toggle: ['co', 'Company-sponsored only'],
    cols: [['NCT ID', mono('nct')], ['Study', (r) => <div className="rc-t"><b>{r.name !== '—' ? r.name : r.title}</b>{r.name !== '—' && <span>{r.title}</span>}</div>], ['Phase', (r) => <span className="tag">{r.phase}</span>], ['Status', (r) => <StBadge v={r.status} />], ['Indication', (r) => <span className="ind-s">{r.ind}</span>], ['Sponsor', (r) => <span className={r.co ? '' : 'muted'}>{r.sponsor}</span>], ['Enrolment', mono('n')], ['Start → primary completion', (r) => <span className="mono nowrap muted">{r.start} → {r.pcd}</span>]] },
  regulatory: { title: 'Regulatory', desc: 'FDA and EMA submissions, decisions, recalls and calendar dates', step: 'regulatory', q: ['app', 'product', 'type', 'cls'], facets: [['region', 'Region'], ['type', 'Record type'], ['status', 'Status']],
    cols: [['Date', mutedDate('date')], ['Region', (r) => <span className="tag mono">{r.region}</span>], ['Record', (r) => <span>{r.type}</span>], ['Application', mono('app')], ['Product', (r) => <b className="fw5">{r.product}</b>], ['Class', (r) => <span className="muted">{r.cls}</span>], ['Status', (r) => <StBadge v={r.status} />]] },
  publications: { title: 'Publications', desc: 'PubMed articles that mention the asset in the title or abstract', step: 'publications', total: () => 210, q: ['title', 'journal', 'pmid'], facets: [['type', 'Design'], ['journal', 'Journal']],
    cols: [['PMID', mono('pmid')], ['Title', (r) => <span className="rc-tt">{r.title}</span>], ['Journal', (r) => <i className="muted">{r.journal}</i>], ['Year', mono('year')], ['Design', (r) => <span className="tag">{r.type}</span>]] },
  conferences: { title: 'Conference abstracts', desc: 'ERS, ATS and CHEST abstracts for the asset', step: 'conferences', total: () => 38, q: ['title', 'congress'], facets: [['congress', 'Congress'], ['type', 'Format']],
    cols: [['Congress', (r) => <b className="fw5 nowrap">{r.congress}</b>], ['Date', mutedDate('date')], ['Abstract', (r) => <span className="rc-tt">{r.title}</span>], ['Format', (r) => <span className={'tag' + (r.type === 'Late-breaking' ? ' lb' : '')}>{r.type}</span>]] },
  documents: { title: 'Documents', desc: 'Prescribing information, annual reports and company documents', step: 'company_site', q: ['title', 'type'], facets: [['type', 'Type']],
    cols: [['Document', (r) => <div className="t-ev"><span className="doc-ic"><Icon name="file" size={14} /></span><b className="fw5">{r.title}</b></div>], ['Type', (r) => <span className="tag">{r.type}</span>], ['Date', mutedDate('date')], ['Pages', mono('pages')]] },
  'company-ir': { title: 'Company IR', desc: 'Press releases from the company newsroom, newest first', step: 'company_news', total: (a) => a.pr, q: ['title', 'cat'], facets: [['cat', 'Category']],
    cols: [['Date', mutedDate('date')], ['Press release', (r) => <span className="rc-tt">{r.title}</span>], ['Category', (r) => <span className="tag">{r.cat}</span>]] },
  patents: { title: 'Patents', desc: 'From AdisInsight, PubChem and Google Patents, with computed expiries', step: 'patents', q: ['num', 'title', 'assignee', 'prod'], facets: [['status', 'Status'], ['assignee', 'Assignee']],
    cols: [['Patent', mono('num')], ['Title', (r) => <span className="rc-tt">{r.title}</span>], ['Covers', (r) => <span className="muted">{r.prod}</span>], ['Assignee', (r) => r.assignee], ['Granted', mutedDate('granted')], ['Expiry', (r) => <span className={'mono nowrap' + (r.expiry < AJ.TODAY ? ' muted' : '')}>{fmtDate(r.expiry)}</span>], ['Status', (r) => <StBadge v={r.status} />]] },
  evidence: { title: 'Evidence', desc: 'Unstructured records and what AI triage decided: ingest in full, keep the headline, or skip', step: 'ai_triage', total: () => 186, q: ['title', 'src', 'reason'], facets: [['verdict', 'Decision']],
    cols: [['Date', mutedDate('date')], ['Record', (r) => <div className="rc-t"><b className="fw5">{r.title}</b><span>{r.src}</span></div>], ['Decision', (r) => <span className={'vd vd-' + r.verdict}>{r.verdict}</span>], ['Reason', (r) => <span className="muted">{r.reason}</span>]] },
};
const GENERIC_COLS = [['Date', mutedDate('date')], ['Record', mono('key')], ['Collection', (r) => <span className="nowrap"><i className="tr-dot inl" style={{ background: AJ.COLL[r.coll].c }}></i>{r.coll}</span>], ['Linked journey event', (r) => <span className="rc-tt">{r.title}</span>]];

function RecordsTab({ a, b, tab, filterFn }) {
  const cfg = REC_CFG[tab];
  const [q, setQ] = rS('');
  const [fv, setFv] = rS({});
  const [tg, setTg] = rS(false);
  const [sel, setSel] = rS(null);
  const [evSel, setEvSel] = rS(null);
  const curated = PE_REC[a.id] && PE_REC[a.id][tab];
  const evs = eventsFor(a.id, b);
  const all = rM(() => curated ? [...curated].sort((x, z) => String(z.date || z.start || z.granted || z.year || '').localeCompare(String(x.date || x.start || x.granted || x.year || ''))) :
    evs.filter(filterFn).flatMap((e) => e.sources.map((s) => ({ key: s.record_key, coll: s.collection, date: e.date, title: e.title, ev: e.id }))).sort((x, z) => z.date.localeCompare(x.date)), [a.id, tab, evs.length]);
  const building = a.id === 'treprostinil' && b.phase !== 'done';
  const st = building ? b.st[cfg.step] : null;
  const avail = !st ? all : st.status === 'pending' ? [] : all.slice(0, Math.ceil(all.length * Math.min(1, st.p * 1.15)));
  const facets = curated ? cfg.facets : [['coll', 'Collection']];
  const rows = avail.filter((r) => (!q || (curated ? cfg.q : ['key', 'title']).some((k) => String(r[k] || '').toLowerCase().includes(q.toLowerCase())))
    && facets.every(([k]) => !fv[k] || String(r[k]) === fv[k]) && (!tg || !cfg.toggle || r[cfg.toggle[0]]));
  const f0 = facets[0][0];
  const dist = Object.entries(avail.reduce((m, r) => ((m[r[f0]] = (m[r[f0]] || 0) + 1), m), {})).sort((x, z) => z[1] - x[1]);
  const tones = ['#2347d9', '#0b7a6f', '#e0620f', '#6941c6', '#98a2b3', '#5873e8', '#b42318'];
  const total = cfg.total ? cfg.total(a) : null;
  const cols = curated ? cfg.cols : GENERIC_COLS;
  const linked = (r) => r.ev && evs.find((e) => e.id === r.ev);
  return (
    <div className="rc">
      {avail.length > 0 && <TabInsights a={a} tab={tab} rows={avail} evs={evs} />}
      <Panel title={cfg.title} desc={cfg.desc}
        actions={building ? <span className={'spill ' + (st.status === 'done' ? 'ok' : 'onb')}><i></i>{`${AJ.byName[cfg.step].short}: ${st.status === 'pending' ? 'queued' : st.status}`}</span> : total ? <span className="muted">{`${fmtNum(total)} records collected`}</span> : null}>
        {avail.length > 0 && (
          <div className="rc-dist">
            <span className="rc-dl">{facets[0][1]}</span>
            <span className="rc-bar">{dist.map(([k, n], i) => <i key={k} title={`${k}: ${n}`} style={{ flexGrow: n, background: tones[i % tones.length] }}></i>)}</span>
            <span className="rc-leg">{dist.slice(0, 5).map(([k, n], i) => <button key={k} className={'rc-lg' + (fv[f0] === k ? ' on' : '')} onClick={() => setFv({ ...fv, [f0]: fv[f0] === k ? undefined : k })}><b style={{ background: tones[i % tones.length] }}></b>{k}<em className="mono">{n}</em></button>)}</span>
          </div>
        )}
        <div className="rc-bar2">
          <label className="as-q sm"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${cfg.title.toLowerCase()}`} /></label>
          {facets.slice(curated ? 1 : 0).map(([k, l]) => (
            <select key={k} className="sel" value={fv[k] || ''} onChange={(e) => setFv({ ...fv, [k]: e.target.value || undefined })} aria-label={l}>
              <option value="">{l}: all</option>{[...new Set(avail.map((r) => String(r[k])))].sort().map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ))}
          {cfg.toggle && curated && <Switch on={tg} onChange={setTg} label={cfg.toggle[1]} />}
        </div>
        {rows.length === 0 ? (
          <div className="empty"><p className="t">{building && st.status === 'pending' ? 'Queued' : 'No records match'}</p><p>{building && st.status === 'pending' ? `This tab fills in when “${AJ.byName[cfg.step].label}” runs.` : 'Try clearing the filters.'}</p></div>
        ) : (
          <div className="tbl-w"><table className="tbl">
            <thead><tr>{cols.map(([l]) => <th key={l}>{l}</th>)}{curated && <th>Journey</th>}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.key + i} className="rowin rc-in" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} onClick={() => setSel(r)}>
                {cols.map(([l, fn]) => <td key={l}>{fn(r)}</td>)}
                {curated && <td>{linked(r) ? <span className="rc-ev" title={linked(r).title}><i style={{ background: AJ.CAT[linked(r).category].c }}></i>Event</span> : <span className="muted">—</span>}</td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="jx-ft">{`Showing ${rows.length} of ${avail.length}${total && total > avail.length && !building ? ` · ${fmtNum(total)} in the record store` : ''}`}</div>
      </Panel>
      {sel && ReactDOM.createPortal(
        <>
          <div className="sheet-ov" onClick={() => setSel(null)}></div>
          <aside className="sheet" role="dialog" aria-label="Record">
            <div className="sh-h"><div className="sh-cat"><span className="tile sm"><Icon name="file" size={14} /></span><span>{cfg.title} record</span></div><button className="icon-btn" aria-label="Close" onClick={() => setSel(null)}><Icon name="x" size={16} /></button></div>
            <div className="sh-b">
              <h2>{sel.name && sel.name !== '—' ? `${sel.name} · ${sel.title}` : sel.title || sel.product || sel.key}</h2>
              <dl className="st-det rc-dl2">{Object.entries(sel).filter(([k, v]) => !['key', 'ev', 'title', 'co'].includes(k) && v !== undefined && v !== '—').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
              {linked(sel) && <><div className="sh-lbl" style={{ marginTop: 18 }}>In the journey</div><button className="wc-i rc-link" onClick={() => { setEvSel(linked(sel)); setSel(null); }}><CatIcon cat={linked(sel).category} size={28} /><span className="wc-m"><span className="wc-t">{linked(sel).title}</span><span className="wc-s mono">{fmtDate(linked(sel).date)}</span></span><Sig v={linked(sel).significance} /></button></>}
            </div>
          </aside>
        </>, document.body)}
      {evSel && <EventSheet e={evSel} list={evs.sort((x, z) => x.date.localeCompare(z.date))} onClose={() => setEvSel(null)} onNav={(id) => setEvSel(evs.find((x) => x.id === id))} />}
    </div>
  );
}

Object.assign(window, { RecordsTab });
