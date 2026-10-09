const { useState: qS } = React;

function KindBadge({ a }) { return <span className={'kind-b k-' + a.kind} title={a.kind === 'primary' ? 'Primary asset · full crawl' : `Competitor of ${a.competitorOf.map((c) => PE.byId[c].name).join(', ')} · light crawl`}><i></i>{a.kind === 'primary' ? 'Primary' : 'Competitor'}</span>; }

function PageHead({ title, desc, actions }) {
  return <div className="pg-h"><div><h1>{title}</h1>{desc && <p>{desc}</p>}</div>{actions}</div>;
}

function AssetSearchPage({ b }) {
  const { go } = useNav();
  const [q, setQ] = qS('');
  const [kind, setKind] = qS('all');
  const [view, setView] = qS('table');
  const list = PE.ASSETS.filter((a) => (kind === 'all' || a.kind === kind) && (!q || (a.name + ' ' + (a.brand || '') + ' ' + a.company + ' ' + a.indications.join(' ') + ' ' + a.mechanism).toLowerCase().includes(q.toLowerCase())));
  const latest = (a) => eventsFor(a.id, b).filter((e) => !e.is_milestone).sort((x, z) => z.date.localeCompare(x.date))[0];
  const status = (a) => a.id === 'treprostinil' && b.phase !== 'done' ? <span className="spill onb"><i></i>{`Collecting · ${Math.round(b.progress * 100)}%`}</span> : <span className="spill ok"><i></i>Ready</span>;
  return (
    <div className="pg">
      <PageHead title="Asset Search" desc="Every tracked asset journey." actions={<button className="btn btn-p" onClick={() => go({ page: 'chat', intent: 'add' })}><Icon name="plus" size={15} />Add asset</button>} />
      <div className="as-bar">
        <label className="as-q"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, brand, company, indication or mechanism" /></label>
        <Seg label="Kind" value={kind} onChange={setKind} options={[{ value: 'all', label: `All ${PE.ASSETS.length}` }, { value: 'primary', label: `Primary ${PE.ASSETS.filter((a) => a.kind === 'primary').length}` }, { value: 'competitor', label: `Competitors ${PE.ASSETS.filter((a) => a.kind === 'competitor').length}` }]} />
        <Seg label="View" value={view} onChange={setView} options={[{ value: 'table', label: '', icon: 'list' }, { value: 'grid', label: '', icon: 'grid' }]} />
      </div>
      {list.length === 0 ? <section className="panel"><div className="empty"><p className="t">No assets match “{q}”</p><p>Add it with Asset AI to start building its journey.</p></div></section>
        : view === 'table' ? (
          <section className="panel"><div className="tbl-w"><table className="tbl">
            <thead><tr><th>Asset</th><th>Indications</th><th>Approved in</th><th>Status</th><th>Events</th><th>Latest update</th></tr></thead>
            <tbody>{list.map((a) => { const l = latest(a); return (
              <tr key={a.id} onClick={() => go({ page: 'asset', id: a.id, tab: 'overview' })} className="rowin">
                <td><div className="t-ev"><AssetTile a={a} size={30} /><span><span className="t-nm"><b>{a.name}</b><KindBadge a={a} /></span><span className="t-sum">{a.brand && a.brand !== a.name ? `${a.brand.split(' · ')[0]} · ` : ''}{a.company}{a.kind === 'competitor' && ` · vs ${a.competitorOf.map((c) => PE.byId[c].name).join(', ')}`}</span></span></div></td>
                <td><div className="chips-s">{a.indications.map((x) => <span key={x} className="tag">{x}</span>)}{a.investigational.map((x) => <span key={x} className="tag dash">{x}</span>)}</div></td>
                <td className="nowrap">{a.regions.join(', ') || '—'}</td>
                <td>{status(a)}</td>
                <td className="mono">{eventsFor(a.id, b).length}</td>
                <td className="t-lat">{l ? <><span className="trunc">{l.title}</span><span className="mono muted">{fmtDate(l.date)}</span></> : <span className="muted">—</span>}</td>
              </tr>); })}</tbody>
          </table></div></section>
        ) : (
          <div className="ta-grid">{list.map((a, i) => { const l = latest(a); return (
            <button key={a.id} className="ta-c" style={{ animationDelay: `${i * 50}ms` }} onClick={() => go({ page: 'asset', id: a.id, tab: 'overview' })}>
              <span className="ta-h"><AssetTile a={a} size={36} /><span className="ta-n"><span className="t-nm"><b>{a.name}</b><KindBadge a={a} /></span><span>{a.company}</span></span>{status(a)}</span>
              <span className="ta-chips">{a.indications.map((x) => <span key={x} className="tag">{x}</span>)}{a.kind === 'competitor' && <span className="tag">vs {a.competitorOf.map((c) => PE.byId[c].name).join(', ')}</span>}</span>
              <Spark evs={eventsFor(a.id, b)} />
              <span className="ta-l"><span className="ta-k">Latest</span><span className="trunc">{l ? l.title : '—'}</span></span>
            </button>); })}</div>
        )}
    </div>
  );
}

const STEP_IC = { pending: ['dashed', 'pend'], running: ['loader', 'run spin'], done: ['check', 'ok'], failed: ['x', 'bad'], skipped: ['dashed', 'pend'] };
function jobFor(j, b) {
  if (j.live) return { ...j, status: b.phase === 'done' ? 'completed_with_errors' : 'running', dur: b.t * SIM_SCALE, started: '2026-10-09T09:02:00', steps: b.steps.length, done: b.doneCount };
  return { ...j, done: j.status === 'failed' ? 1 : j.steps };
}

function JobsPage({ b }) {
  const { go } = useNav();
  return (
    <div className="pg">
      <PageHead title="Crawl jobs" desc="Data collection runs for your assets, newest first." />
      <section className="panel"><div className="tbl-w"><table className="tbl">
        <thead><tr><th>Asset</th><th>Type</th><th>Status</th><th>Steps</th><th>Requested by</th><th>Started</th><th>Duration</th></tr></thead>
        <tbody>{PE.JOBS.map((j0) => { const j = jobFor(j0, b); return (
          <tr key={j.id} className="rowin" onClick={() => go({ page: 'job', id: j.id })}>
            <td><div className="t-ev"><AssetTile a={PE.byId[j.asset]} size={24} /><b>{PE.byId[j.asset].name}</b></div></td>
            <td className="cap">{j.type}</td><td><JobBadge status={j.status} /></td>
            <td><span className="steps-m"><span className="mono">{j.done}/{j.steps}</span><span className="mini-bar"><i style={{ width: `${(j.done / j.steps) * 100}%` }} className={j.status === 'failed' ? 'bad' : ''}></i></span></span></td>
            <td>{j.by}</td><td className="muted nowrap">{new Date(j.started).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td className="mono">{fmtDur(j.dur)}</td>
          </tr>); })}</tbody>
      </table></div></section>
    </div>
  );
}

function JobPage({ b, route }) {
  const { go } = useNav();
  const j0 = PE.JOBS.find((x) => x.id === route.id) || PE.JOBS[0];
  const j = jobFor(j0, b), a = PE.byId[j.asset];
  const plan = j.type === 'competitor' ? ['regulatory', 'fda_calendar', 'ema_chmp', 'clinical', 'publications', 'conferences', 'news', 'patents', 'journey', 'ai_triage', 'ai_events', 'index', 'finalize'] : AJ.STEPS.map((s) => s.name);
  const steps = j.live ? b.steps : plan.map((n, i) => {
    const s = AJ.byName[n];
    if (j.err && j.status === 'failed') return { ...s, status: i === 0 ? 'failed' : 'skipped', error: i === 0 ? j.err.msg : null, live: {} };
    return { ...s, status: j.err && j.err.step === n ? 'skipped' : 'done', error: j.err && j.err.step === n ? j.err.msg : null, live: s.counts };
  });
  return (
    <div className="pg">
      <nav className="crumb"><button className="link-q" onClick={() => go({ page: 'jobs' })}>Crawl jobs</button><span className="sep">/</span><span className="cur">{j.id}</span></nav>
      <PageHead title={`${a.name} · ${j.type}`} desc={`Requested by ${j.by} · ${new Date(j.started).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`}
        actions={<div className="jx-acts"><JobBadge status={j.status} />{j.live && <button className="btn btn-sm" onClick={() => go({ page: 'asset', id: a.id, tab: 'overview', build: true })}><Icon name="activity" size={14} />Live build view</button>}<button className="btn btn-sm" onClick={() => go({ page: 'asset', id: a.id, tab: 'overview' })}>Open asset<Icon name="arrowR" size={13} /></button></div>} />
      <Panel title="Steps" desc={`${fmtDur(j.dur)}${j.status === 'running' ? ' so far' : ''} · ${j.done} of ${j.steps} finished`}>
        <ol className="steps">{steps.map((s, i) => {
          const st = s.warnOn ? ['alert', 'warn'] : STEP_IC[s.status];
          const counts = Object.entries(s.live || {}).filter(([, v]) => v > 0);
          return (
            <li key={s.name} className={'step is-' + s.status}>
              <span className={'step-ic ' + st[1]}><Icon name={st[0]} size={st[0] === 'check' ? 11 : 15} sw={st[0] === 'check' ? 3 : 2} /></span>
              <div className="step-m"><p className="step-l">{s.label}</p>
                {counts.length > 0 && <p className="step-c mono">{counts.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${fmtNum(v)}`).join(' · ')}</p>}
                {(s.error || (s.warnOn && s.warn)) && <p className={'step-e' + (s.status === 'failed' ? ' bad' : '')}>{s.error || s.warn}</p>}
                {s.status === 'running' && <span className="mini-bar"><i style={{ width: `${s.p * 100}%` }}></i></span>}
              </div>
              <span className="step-s">{s.status}</span>
            </li>);
        })}</ol>
      </Panel>
    </div>
  );
}

function UploadsPage() {
  return (
    <div className="pg">
      <PageHead title="Uploads" desc="Add your own documents to an asset journey." />
      <section className="panel soon"><span className="tile lg"><Icon name="upload" size={22} /></span><h3>Coming soon</h3><p>Drop PDFs, slide decks and internal reports onto an asset. They’ll be triaged and dated like any other source, and cited by Asset AI.</p></section>
    </div>
  );
}

function SettingsPage() {
  const [n, setN] = qS({ high: true, crawl: true, digest: false });
  const team = [['Alex Morgan', 'alex.morgan@pharmaedge.io', 'Analyst'], ['Priya Shah', 'priya.shah@pharmaedge.io', 'Admin'], ['Daniel Okafor', 'daniel.okafor@pharmaedge.io', 'Analyst'], ['Mei Lin', 'mei.lin@pharmaedge.io', 'Viewer']];
  return (
    <div className="pg">
      <PageHead title="Settings" desc="Your profile, notifications and team." />
      <div className="set-g">
        <Panel title="Profile"><div className="set-p"><span className="av lg">AM</span><div><b>{PE.USER.name}</b><p className="muted">{PE.USER.email}</p><span className="tag">{PE.USER.role}</span></div></div></Panel>
        <Panel title="Notifications" desc="What PharmaEdge tells you about">
          <div className="set-n">
            <Switch on={n.high} onChange={(v) => setN({ ...n, high: v })} label="High-significance events on my assets" />
            <Switch on={n.crawl} onChange={(v) => setN({ ...n, crawl: v })} label="Crawl finished or failed" />
            <Switch on={n.digest} onChange={(v) => setN({ ...n, digest: v })} label="Weekly portfolio digest by email" />
          </div>
        </Panel>
      </div>
      <Panel title="Team" desc={`${team.length} members`} actions={<button className="btn btn-sm"><Icon name="plus" size={14} />Invite</button>}>
        <div className="tbl-w"><table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
          <tbody>{team.map(([nm, em, r]) => <tr key={em}><td><div className="t-ev"><span className="av">{nm.split(' ').map((p) => p[0]).join('')}</span><b>{nm}</b></div></td><td className="muted">{em}</td><td><span className="tag">{r}</span></td></tr>)}</tbody></table></div>
      </Panel>
    </div>
  );
}

Object.assign(window, { KindBadge, AssetSearchPage, JobsPage, JobPage, UploadsPage, SettingsPage, PageHead });
