const { useState: pS } = React;

const ASSET_TABS = [['overview', 'Overview'], ['analytics', 'Analytics'], ['evidence', 'Evidence'], ['clinical', 'Clinical'], ['regulatory', 'Regulatory'], ['publications', 'Publications'], ['conferences', 'Conferences'], ['documents', 'Documents'], ['company-ir', 'Company IR'], ['patents', 'Patents'], ['competitors', 'Competitors']];
const TAB_FILTER = {
  evidence: () => true,
  clinical: (e) => e.category === 'clinical',
  regulatory: (e) => e.category === 'regulatory' || e.category === 'safety',
  publications: (e) => e.type === 'publication' || e.sources.some((s) => s.collection === 'publication_records'),
  conferences: (e) => e.type === 'conference' || e.sources.some((s) => s.collection === 'conference_records'),
  documents: (e) => e.sources.some((s) => s.collection === 'company_records') && e.category !== 'company',
  'company-ir': (e) => e.category === 'company' || e.sources.some((s) => s.collection === 'company_records'),
  patents: (e) => e.category === 'ip',
};
const TAB_STEP = { evidence: 'ai_triage', clinical: 'clinical', regulatory: 'regulatory', publications: 'publications', conferences: 'conferences', documents: 'company_site', 'company-ir': 'company_news', patents: 'patents' };

function AssetHead({ a, b, tabLabel }) {
  const { go } = useNav();
  const building = a.id === 'treprostinil' && b.phase !== 'done';
  return (
    <div className="ah">
      <nav aria-label="Breadcrumb" className="crumb"><button className="link-q" onClick={() => go({ page: 'assets' })}>Asset Journey</button><span className="sep">/</span><button className="link-q" onClick={() => go({ page: 'asset', id: a.id, tab: 'overview' })}>{a.name}</button><span className="sep">/</span><span className="cur">{tabLabel}</span></nav>
      <div className="ah-row">
        <div className="ah-id">
          <span className="ah-logo"><Icon name="pill" size={28} /></span>
          <div className="ah-m">
            <div className="ah-name"><h1>{a.name}</h1>
              {building ? <span className="spill onb"><i></i>Collecting data</span> : a.regions.length ? <span className="spill ok"><i></i>{`Approved · ${a.regions.join(', ')}`}</span> : <span className="spill inv">Investigational</span>}
              {a.kind === 'competitor' && <span className="tag">Competitor</span>}
            </div>
            <p className="ah-sub"><b>{a.company}</b> · {a.modality} · {a.mechanism}</p>
            {a.kind === 'competitor' ? <p className="ah-aka">Competitor of {a.competitorOf.map((c, i) => <React.Fragment key={c}>{i > 0 && ', '}<button className="link-q pri" onClick={() => go({ page: 'asset', id: c, tab: 'competitors' })}>{PE.byId[c].name}</button></React.Fragment>)}</p>
              : a.brand && <p className="ah-aka">Also known as {a.brand.split(' · ').join(', ')}</p>}
            <ul className="ah-chips" aria-label="Indications">
              {a.indications.map((i) => <li key={i} className="chip">{i}</li>)}
              {a.investigational.map((i) => <li key={i} className="chip dash">{`${i} (investigational)`}</li>)}
            </ul>
          </div>
        </div>
        <div className="ah-btns">
          <button className="btn" disabled={building} title={building ? 'Available once onboarding finishes' : ''}><Icon name="refresh" size={15} />Refresh data</button>
          <button className="btn btn-p" onClick={() => go({ page: 'chat', ask: `What should I know about ${a.name}?` })}><Icon name="sparkles" size={15} />Ask Asset AI</button>
        </div>
      </div>
    </div>
  );
}

function EventsTab({ a, b, tab }) {
  const [sel, setSel] = pS(null);
  const all = eventsFor(a.id, b);
  const list = all.filter(TAB_FILTER[tab]).sort((x, z) => z.date.localeCompare(x.date));
  const label = ASSET_TABS.find((t) => t[0] === tab)[1];
  const step = AJ.byName[TAB_STEP[tab]];
  const building = a.id === 'treprostinil' && b.phase !== 'done';
  const stepState = building && b.st[step.name].status;
  return (
    <Panel title={label} desc={`Journey events backed by ${label.toLowerCase()} records, newest first. Select a row to see its evidence.`}
      actions={building && <span className={'spill ' + (stepState === 'done' ? 'ok' : 'onb')}><i></i>{`${step.short}: ${stepState === 'pending' ? 'queued' : stepState}`}</span>}>
      {list.length === 0 ? (
        <div className="empty"><p className="t">{building ? 'Still collecting' : 'Nothing here yet'}</p><p>{building ? `This tab fills in once “${step.label}” and the journey steps have run.` : 'No events from these sources yet.'}</p></div>
      ) : (
        <div className="tbl-w"><table className="tbl">
          <thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Significance</th><th>Evidence</th></tr></thead>
          <tbody>{list.map((e) => (
            <tr key={e.id} onClick={() => setSel(e)} className="rowin">
              <td className="mono nowrap muted">{e.is_milestone ? `Exp. ${fmtMonth(e.date)}` : fmtDate(e.date)}</td>
              <td><div className="t-ev"><CatIcon cat={e.category} size={24} /><span><b>{e.title}</b>{e.summary && <span className="t-sum">{e.summary}</span>}</span></div></td>
              <td className="mono muted nowrap">{e.type.replace(/_/g, ' ')}</td>
              <td><Sig v={e.significance} /></td>
              <td className="nowrap"><span className={'via via-' + e.via}>{viaLabel(e)}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {sel && <EventSheet e={sel} list={list} onClose={() => setSel(null)} onNav={(id) => setSel(list.find((x) => x.id === id))} />}
    </Panel>
  );
}

function CompetitorsTab({ a }) {
  const { go } = useNav();
  const comps = a.kind === 'primary' ? PE.ASSETS.filter((c) => c.competitorOf.includes(a.id)) : a.competitorOf.map((id) => PE.byId[id]);
  const inds = [...a.indications, ...a.investigational];
  const cov = (c, i) => (c.indications.includes(i) ? 'approved' : c.investigational.includes(i) ? 'investigational' : 'none');
  return (
    <Panel title={a.kind === 'primary' ? 'Competitors' : 'Competes with'} desc={a.kind === 'primary' ? `Ranked by shared indication and mechanism. Each is crawled lightly and has its own journey.` : 'Primary assets this competitor is tracked against.'}>
      <div className="cp-grid">
        {comps.map((c, i) => (
          <div key={c.id} className="cp-c" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="cp-h"><AssetTile a={c} size={34} /><div className="cp-n"><b>{c.name}</b><span>{c.brand && c.brand !== c.name ? `${c.brand} · ` : ''}{c.company}</span></div>{c.stage && <span className={'tag stage-' + c.stage}>{{ approved: 'Approved', phase3: 'Phase 3', phase2: 'Phase 2' }[c.stage] || c.stage}</span>}</div>
            <p className="cp-mech">{c.mechanism}</p>
            {inds.length > 0 && a.kind === 'primary' && <div className="cp-cov">{inds.map((x) => <span key={x} className={'cov cov-' + cov(c, x)}>{x}</span>)}</div>}
            <div className="cp-f">{c.basis && <span className="muted">Shared {c.basis === 'both' ? 'indication and mechanism' : c.basis}</span>}<span className="sp"></span><button className="btn btn-sm" onClick={() => go({ page: 'asset', id: c.id, tab: 'overview' })}>Open journey<Icon name="arrowR" size={13} /></button></div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AssetPage({ b, route, reveal, layout, scrollRef, timeline }) {
  const { go } = useNav();
  const a = PE.byId[route.id] || PE.byId.treprostinil;
  const tab = route.tab || 'overview';
  const tabLabel = ASSET_TABS.find((t) => t[0] === tab)[1];
  const live = a.id === 'treprostinil';
  const building = live && b.phase !== 'done';
  const evs = eventsFor(a.id, b);
  const comps = PE.ASSETS.filter((c) => c.competitorOf.includes(a.id)).length;
  const kpis = [
    ['landmark', 'Approved in', a.regions.length ? a.regions.join(', ') : '—', 'FDA and EMA authorisations'],
    ['flask', 'Trials', String(a.trials), 'ClinicalTrials.gov studies'],
    ['calendar', 'Upcoming milestones', String(evs.filter((e) => e.is_milestone).length), 'Readouts, decisions, patent expiries'],
    ['route', 'Journey events', String(evs.length), 'Regulatory, clinical, patent and company'],
    ['megaphone', 'Company releases', String(a.pr || '—'), a.company],
  ];
  let body;
  if (tab === 'overview') {
    if (live && (building || route.build)) body = <LiveBuild key="live" b={b} onExplore={() => { go({ ...route, build: false }); }} />;
    else {
      const TL = timeline === 'classic' ? JourneyExplorer : JourneyStory;
      body = <TL key={a.id + timeline} extra={<OverviewAnalytics key={'ov' + a.id} a={a} b={b} />} asset={a.id} focusId={route.focus} events={live ? AJ.EVENTS : evs} kpis={live ? undefined : kpis} reveal={reveal} layout={layout} scrollRef={scrollRef} onShowBuild={live ? () => go({ ...route, build: true }) : undefined} />;
    }
  } else if (tab === 'competitors') body = <CompetitorsTab a={a} />;
  else if (tab === 'analytics') body = <AnalyticsTab key={a.id} a={a} b={b} />;
  else body = <RecordsTab key={a.id + tab} a={a} b={b} tab={tab} filterFn={TAB_FILTER[tab]} />;
  return (
    <div className="asset-pg">
      <AssetHead a={a} b={b} tabLabel={building && tab === 'overview' ? 'Building journey' : tabLabel} />
      <nav className="tabs" aria-label="Asset sections">
        {ASSET_TABS.map(([k, l]) => (
          <button key={k} className={'tab' + (k === tab ? ' on' : '')} onClick={() => go({ page: 'asset', id: a.id, tab: k })}>{l}
            {k === 'overview' && building && <i className="live-dot"></i>}
            {k === 'competitors' && comps > 0 && <span className="tab-n">{comps}</span>}
          </button>
        ))}
      </nav>
      {body}
    </div>
  );
}

Object.assign(window, { AssetPage });
