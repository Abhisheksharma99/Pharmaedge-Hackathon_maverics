const { useState: cS, useEffect: cE, useRef: cR } = React;

function IdentityCardS() {
  const facts = [['Company', <><b>United Therapeutics</b> · <span className="pri">unither.com</span> <Icon name="check" size={11} sw={3} className="ok-ic" /></>], ['IR page', <span className="pri">ir.unither.com/news</span>], ['Indications', <span className="chips-s"><span className="tag">PAH</span><span className="tag">PH-ILD</span><span className="tag dash">IPF (investigational)</span></span>], ['Mechanism', 'Prostacyclin analogue'], ['Found in', 'FDA 44 · EMA 12 · Trials 74 · PubMed 210']];
  return (
    <div className="cc">
      <div className="cc-h"><span className="tile pri-soft"><Icon name="pill" size={17} /></span><div><b>Treprostinil</b><span>Also known as Remodulin, Tyvaso, Tyvaso DPI, Orenitram</span></div></div>
      <dl className="cc-f">{facts.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
      <div className="cc-plan"><b>Plan: </b>17 steps · regulatory, trials, publications, conferences, company and news first, then rules and AI build the journey.</div>
      <div className="cc-ft"><span className="ok-t"><Icon name="check" size={14} sw={2.6} />Crawl started</span></div>
    </div>
  );
}

function JobCardS({ b }) {
  const { go } = useNav();
  const done = b.phase === 'done';
  return (
    <div className="cc">
      <div className="cc-row"><div><b>Collecting data for Treprostinil</b><span className="muted">{done ? `${b.doneCount} of 17 steps finished` : b.phase === 'planning' ? 'Planning…' : `Step ${b.current.i + 1} of 17 · ${b.current.label}`}</span></div><JobBadge status={done ? 'completed_with_errors' : 'running'} /></div>
      <span className="cr-bar">{b.steps.map((s) => <i key={s.name} className={s.status} style={{ flexGrow: s.dur, '--p': `${s.p * 100}%` }}></i>)}</span>
      <div className="cc-stats"><span><b>{fmtNum(b.records.length)}</b> records</span><span><b>{b.events.length}</b> events</span><span><b>{b.srcDone}/{b.srcTotal}</b> sources</span></div>
      <button className="link-q pri" onClick={() => go({ page: 'asset', id: 'treprostinil', tab: 'overview', build: !done || undefined })}>{done ? 'Open the journey' : 'Watch the live build'} <Icon name="arrowUR" size={13} /></button>
    </div>
  );
}

function answerFor(q, b) {
  const evs = allEvents(b), s = q.toLowerCase();
  const pick = (xs) => xs.map((e) => ({ e, a: PE.byId[e.asset] }));
  if (/^add\s+(.+)/i.test(q)) {
    const name = q.replace(/^add\s+/i, '').trim();
    const hit = PE.ASSETS.find((a) => a.name.toLowerCase() === name.toLowerCase() || (a.brand || '').toLowerCase().includes(name.toLowerCase()));
    if (hit) return { tool: ['Resolving asset', 'already tracked'], intro: `**${hit.name}** is already tracked${hit.kind === 'competitor' ? ' as a competitor, with a lighter crawl' : ''}. Its journey has ${eventsFor(hit.id, b).length} events.`, link: hit };
    return { tool: ['Resolving asset in FDA, EMA, ClinicalTrials.gov and PubMed', 'no confident match'], intro: `I couldn’t find a confident match for **${name}** in FDA, EMA, ClinicalTrials.gov or PubMed. Try the generic name or a brand name, or include the company.` };
  }
  if (/milestone|upcoming|next|expected|pdufa|readout/.test(s)) {
    const up = evs.filter((e) => e.is_milestone).sort((a, z) => a.date.localeCompare(z.date));
    return { tool: ['Searching milestones', `${up.length} found`], intro: `There are **${up.length} expected milestones** across your assets and their competitors. The nearest are:`, items: pick(up.slice(0, 5)), outro: 'Dates come from ClinicalTrials.gov primary completion dates, the FDA calendar and patent terms, so they can move.' };
  }
  if (/compare|yutrepia|versus|vs\.?\s/.test(s)) {
    return { tool: ['Comparing journeys', 'Treprostinil · Yutrepia'], intro: 'Both are inhaled treprostinil for **PAH and PH-ILD**. Treprostinil (Tyvaso DPI) has been approved since 2022; Yutrepia followed in May 2025 after the ’793 patent was invalidated.', items: pick([AJ.EVENTS.find((e) => e.id === 'e27'), AJ.EVENTS.find((e) => e.id === 'e31'), PE.EV.find((e) => e.id === 'c1'), AJ.EVENTS.find((e) => e.id === 'e36')].map((e) => ({ ...e, asset: e.asset || 'treprostinil' }))), outro: 'Treprostinil’s IPF filing (TETON) is the main differentiator to watch.' };
  }
  if (/phase 3|readout|topline|trial/.test(s)) {
    const t = evs.filter((e) => e.type === 'topline' || (e.type === 'publication' && e.significance !== 'Low')).sort((a, z) => z.date.localeCompare(a.date));
    return { tool: ['Searching evidence', `${t.length * 3} passages`], intro: 'The latest pivotal readouts across your assets:', items: pick(t.slice(0, 5)) };
  }
  const recent = evs.filter((e) => !e.is_milestone && daysFrom(e.date) <= 0 && daysFrom(e.date) >= -90 && e.significance !== 'Low').sort((a, z) => z.date.localeCompare(a.date));
  return { tool: ['Searching evidence', `${recent.length * 2 + 4} passages`], intro: `Here’s what changed across your portfolio in the last 90 days: **${recent.length} key events**.`, items: pick(recent.slice(0, 5)), outro: 'Select a citation to see the records behind it.' };
}

const md = (t) => t.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));

function AiMsg({ m, b, onCite, live, onDone }) {
  const { go } = useNav();
  const [n, setN] = cS(live ? 0 : 1e9);
  const [phase, setPhase] = cS(live ? 'tool' : 'done');
  const intro = m.ans ? m.ans.intro : m.text || '';
  cE(() => {
    if (!live) return;
    const t1 = setTimeout(() => setPhase('type'), 900);
    return () => clearTimeout(t1);
  }, []);
  cE(() => {
    if (phase !== 'type') return;
    if (n >= intro.length) { const t = setTimeout(() => { setPhase('done'); onDone && onDone(); }, 150); return () => clearTimeout(t); }
    const t = setTimeout(() => setN((x) => x + 3), 14);
    return () => clearTimeout(t);
  }, [phase, n]);
  const a = m.ans;
  const shown = phase === 'done' ? intro : intro.slice(0, n);
  return (
    <div className="msg ai">
      <span className="ai-mark"><Icon name="sparkles" size={14} /></span>
      <div className="msg-b">
        {a && a.tool && <div className="tool">{phase === 'tool' ? <Icon name="loader" size={13} className="spin pri" /> : <Icon name="check" size={13} sw={2.6} className="ok-ic" />}<span>{a.tool[0]}</span>{phase !== 'tool' && <span className="muted">· {a.tool[1]}</span>}</div>}
        {phase !== 'tool' && intro && <p className={'msg-t' + (phase === 'type' ? ' caret' : '')}>{md(shown)}</p>}
        {phase === 'done' && a && a.items && (
          <ol className="ans-l">{a.items.map(({ e, a: as }, i) => (
            <li key={i} style={{ animationDelay: `${i * 90}ms` }}><CatIcon cat={e.category} size={22} /><span><b>{e.title}</b><span className="muted"> · {as.name} · {e.is_milestone ? `expected ${fmtMonth(e.date)}` : fmtDate(e.date)}</span></span><button className="cite" onClick={() => onCite(e)}>{i + 1}</button></li>
          ))}</ol>
        )}
        {phase === 'done' && a && a.outro && <p className="msg-t">{a.outro}</p>}
        {phase === 'done' && a && a.link && <button className="link-q pri" onClick={() => go({ page: 'asset', id: a.link.id, tab: 'overview' })}>Open {a.link.name} <Icon name="arrowUR" size={13} /></button>}
        {phase === 'done' && m.cards && m.cards.map((c, i) => <div key={i} className="cc-w">{c === 'identity' ? <IdentityCardS /> : <JobCardS b={b} />}</div>)}
      </div>
    </div>
  );
}

const SEED = [
  { id: 1, role: 'user', text: 'Add treprostinil' },
  { id: 2, role: 'ai', text: 'I found **Treprostinil** from United Therapeutics, approved in the US and EU for PAH and PH-ILD and in Phase 3 for IPF. Check the identity and I’ll start building its journey.', cards: ['identity'] },
  { id: 3, role: 'ai', text: 'Crawl started. The journey fills in as each source finishes; you can keep working.', cards: ['job'] },
];
const HISTORY = [['Add treprostinil', 'Treprostinil', 'Today'], ['Winrevair label update impact', 'Sotatercept', 'Yesterday'], ['COPD biologics landscape', 'Dupilumab', 'Oct 2'], ['Ohtuvayre EU timeline', 'Ensifentrine', 'Sep 28'], ['ERS 2026 highlights', null, 'Sep 30']];
const SUGGEST = ['Which assets have milestones in the next six months?', 'What changed across my assets this month?', 'Compare Treprostinil with Yutrepia', 'Summarize the latest Phase 3 readouts'];

function ChatPage({ b, route }) {
  const { go } = useNav();
  const [msgs, setMsgs] = cS(SEED);
  const [draft, setDraft] = cS(route.intent === 'add' ? 'Add ' : '');
  const [busy, setBusy] = cS(false);
  const [liveId, setLiveId] = cS(null);
  const [cite, setCite] = cS(null);
  const end = cR(null), box = cR(null), ta = cR(null);
  const send = (text) => {
    const t = text.trim(); if (!t || busy) return;
    const id = Date.now();
    setMsgs((m) => [...m, { id, role: 'user', text: t }, { id: id + 1, role: 'ai', ans: answerFor(t, b) }]);
    setLiveId(id + 1); setBusy(true); setDraft('');
  };
  cE(() => { if (route.ask) send(route.ask); if (route.intent === 'add' && ta.current) { ta.current.focus(); } }, [route.ask, route.intent]);
  cE(() => { const el = box.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [msgs.length, busy]);
  return (
    <div className="chat">
      <aside className="ch-side">
        <button className="btn btn-sm ch-new" onClick={() => { setMsgs([]); setLiveId(null); }}><Icon name="plus" size={14} />New chat</button>
        <p className="ch-g">Recent</p>
        {HISTORY.map(([t, a, w], i) => <button key={t} className={'ch-i' + (i === 0 ? ' on' : '')}><span className="trunc">{t}</span><span className="ch-m">{a && <span className="tag">{a}</span>}<span>{w}</span></span></button>)}
      </aside>
      <section className="ch-main">
        <div className="ch-top"><b>Asset AI</b><span className="muted">Your copilot for asset intelligence</span></div>
        <div className="ch-thread" ref={box}>
          {msgs.length === 0 && (
            <div className="ch-empty"><span className="tile vio lg"><Icon name="sparkles" size={22} /></span><h2>What do you want to know?</h2><p>Ask about your assets, their competitors and the evidence behind them, or add a new asset to track.</p>
              <div className="ch-sug">{SUGGEST.map((q) => <button key={q} className="ask-q" onClick={() => send(q)}>{q}<Icon name="arrowR" size={13} /></button>)}</div>
            </div>
          )}
          {msgs.map((m) => m.role === 'user'
            ? <div key={m.id} className="msg user"><p>{m.text}</p></div>
            : <AiMsg key={m.id} m={m} b={b} live={m.id === liveId} onCite={setCite} onDone={() => setBusy(false)} />)}
          <div ref={end}></div>
        </div>
        {msgs.length > 0 && !busy && <div className="ch-fu">{SUGGEST.slice(0, 3).map((q) => <button key={q} className="fu" onClick={() => send(q)}>{q}</button>)}</div>}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <textarea ref={ta} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }} placeholder="Ask about your assets, or type “Add” and a drug name…" aria-label="Ask Asset AI" />
          <button type="submit" className="btn btn-p btn-sm" disabled={busy || !draft.trim()}>{busy ? <Icon name="loader" size={14} className="spin" /> : <Icon name="send" size={14} />}</button>
        </form>
      </section>
      {cite && <EventSheet e={cite} list={[cite]} onClose={() => setCite(null)} onNav={() => {}} />}
    </div>
  );
}

Object.assign(window, { ChatPage });
