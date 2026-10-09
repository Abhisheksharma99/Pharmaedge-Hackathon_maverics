const { useState: aS, useEffect: aE, useRef: aR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "speed": "1×",
  "reveal": "expressive",
  "layout": "rail",
  "timeline": "story"
}/*EDITMODE-END*/;

const NAV = [
  ['Workspace', [['home', 'Home'], ['search', 'Asset Search'], ['sparkles', 'Asset AI']]],
  ['Intelligence', [['route', 'Asset Journey', true], ['building', 'Company IR'], ['calendar', 'Conferences']]],
  ['Data', [['upload', 'Uploads', false, true], ['activity', 'Crawl jobs']]],
];
const TABS = ['Overview', 'Evidence', 'Clinical', 'Regulatory', 'Publications', 'Conferences', 'Documents', 'Company IR', 'Patents', 'Competitors'];

function Sidebar() {
  return (
    <aside className="sb">
      <div className="sb-logo">Pharma<span>Edge</span></div>
      <nav className="sb-nav" aria-label="Main">
        {NAV.map(([g, items]) => (
          <div key={g} className="sb-grp"><p>{g}</p>
            {items.map(([ic, l, on, soon]) => <a key={l} href="#" onClick={(e) => e.preventDefault()} className={'sb-item' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined}><Icon name={ic} size={16} /><span>{l}</span>{soon && <span className="sb-soon">Soon</span>}</a>)}
          </div>
        ))}
      </nav>
      <div className="sb-foot"><a href="#" onClick={(e) => e.preventDefault()} className="sb-item"><Icon name="settings" size={16} /><span>Settings</span></a></div>
    </aside>
  );
}

function AssetHeader({ ready, view }) {
  const a = AJ.ASSET;
  return (
    <div className="ah">
      <nav aria-label="Breadcrumb" className="crumb"><a href="#" onClick={(e) => e.preventDefault()}>Asset Journey</a><span className="sep">/</span><a href="#" onClick={(e) => e.preventDefault()}>{a.name}</a><span className="sep">/</span><span className="cur">{view === 'live' && !ready ? 'Building journey' : 'Overview'}</span></nav>
      <div className="ah-row">
        <div className="ah-id">
          <span className="ah-logo"><Icon name="pill" size={28} /></span>
          <div className="ah-m">
            <div className="ah-name"><h1>{a.name}</h1>
              {ready ? <span className="spill ok"><i></i>Approved · {a.approvalRegions.join(', ')}</span> : <span className="spill onb"><i></i>Collecting data</span>}
            </div>
            <p className="ah-sub"><b>{a.company}</b> · {a.modality} · {a.mechanism}</p>
            <p className="ah-aka">Also known as {a.aliases.join(', ')}</p>
            <ul className="ah-chips" aria-label="Approved indications">
              {a.indications.map((i) => <li key={i} className="chip">{i}</li>)}
              {a.investigational.map((i) => <li key={i} className="chip dash">{`${i} (investigational)`}</li>)}
            </ul>
          </div>
        </div>
        <div className="ah-btns">
          <button className="btn" disabled={!ready} title={ready ? '' : 'Available once onboarding finishes'}><Icon name="refresh" size={15} />Refresh data</button>
          <button className="btn btn-p"><Icon name="sparkles" size={15} />Ask Asset AI</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const speed = { '1×': 1, '2×': 2, '4×': 4 }[tw.speed] || 1;
  const [t, setT] = useBuild(speed, true);
  const [view, setView] = aS(() => localStorage.getItem('aj.view') || 'live');
  const scrollRef = aR(null);
  const b = deriveBuild(t);
  const ready = b.phase === 'done';
  const shownView = ready ? view : 'live';
  aE(() => { localStorage.setItem('aj.view', view); }, [view]);
  const go = (v) => { setView(v); if (scrollRef.current) scrollRef.current.scrollTo({ top: 0 }); };
  window.__aj = { setT, go };

  return (
    <div className="app">
      <Sidebar />
      <div className="col">
        <header className="hdr">
          <div className="search"><Icon name="search" size={15} /><span>Search PharmaEdge</span><kbd>⌘K</kbd></div>
          <div className="me"><span className="av">AM</span><span className="me-n">Alex Morgan</span></div>
        </header>
        <main className="scroll" ref={scrollRef}>
          <div className="page">
            <AssetHeader ready={ready} view={shownView} />
            <nav className="tabs" aria-label="Asset sections">
              {TABS.map((l, i) => <span key={l} className={'tab' + (i === 0 ? ' on' : '')}>{l}{i === 0 && !ready && <i className="live-dot"></i>}</span>)}
            </nav>
            {shownView === 'live'
              ? <LiveBuild key="live" b={b} onExplore={() => go('journey')} />
              : tw.timeline === 'classic' ? <JourneyExplorer key="journey" reveal={tw.reveal} layout={tw.layout} scrollRef={scrollRef} onShowBuild={() => go('live')} /> : <JourneyStory key="story" scrollRef={scrollRef} onShowBuild={() => go('live')} />}
          </div>
        </main>
      </div>
      <TweaksPanel title="Tweaks">
        <TweakSection label="Live build" />
        <TweakRadio label="Speed" value={tw.speed} options={['1×', '2×', '4×']} onChange={(v) => setTweak('speed', v)} />
        <TweakButton label="Restart build" onClick={() => { setT(0); go('live'); }} />
        <TweakButton label="Skip to ready" secondary onClick={() => setT(AJ.TOTAL)} />
        <TweakSection label="Journey timeline" />
        <TweakRadio label="Style" value={tw.timeline} options={[{ value: 'story', label: 'Tree' }, { value: 'classic', label: 'Classic' }]} onChange={(v) => setTweak('timeline', v)} />
        <TweakRadio label="Scroll reveal" value={tw.reveal} options={['subtle', 'expressive', 'off']} onChange={(v) => setTweak('reveal', v)} />
        <TweakRadio label="Layout" value={tw.layout} options={[{ value: 'rail', label: 'Single rail' }, { value: 'alternate', label: 'Alternating' }]} onChange={(v) => setTweak('layout', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
