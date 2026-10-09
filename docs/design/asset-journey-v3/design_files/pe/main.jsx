const { useState: mS, useEffect: mE, useRef: mR } = React;

const PE_TWEAKS = /*EDITMODE-BEGIN*/{
  "speed": "1×",
  "reveal": "expressive",
  "layout": "rail",
  "timeline": "story"
}/*EDITMODE-END*/;

const HP = () => new URLSearchParams(location.hash.replace(/^#\/?/, ''));
function parseHash() { const p = HP(); if (!p.get('page')) return null; const r = {}; p.forEach((v, k) => { if (k !== 'sim' && k !== 'pal' && k !== 'orient') r[k] = v; }); if (r.build) r.build = r.build === '1'; return r; }
const SIM = HP().get('sim');
if (HP().get('orient')) localStorage.setItem('aj.orient', HP().get('orient'));
function loadRoute() { const h = parseHash(); if (h) return h; try { const r = JSON.parse(localStorage.getItem('pe.route')); if (r && r.page) return r; } catch (e) {} return { page: 'home' }; }

function PEApp() {
  const [tw, setTweak] = useTweaks(PE_TWEAKS);
  const speed = { '1×': 1, '2×': 2, '4×': 4 }[tw.speed] || 1;
  const [t, setT] = useBuild(speed, true, 'pe.simT', SIM === 'done' ? AJ.TOTAL : SIM ? parseFloat(SIM) : null);
  const b = deriveBuild(t);
  const [route, setRoute] = mS(loadRoute);
  const [lastAsset, setLastAsset] = mS(route.id && route.page === 'asset' ? route.id : 'treprostinil');
  const [pal, setPal] = mS(HP().get('pal') === '1');
  const [collapsed, setCollapsed] = mS(false);
  const [drawer, setDrawer] = mS(false);
  const scrollRef = mR(null);
  const go = (r) => {
    setRoute(r); setDrawer(false);
    const q = new URLSearchParams(); Object.entries(r).forEach(([k, v]) => { if (v !== undefined && v !== false && k !== 'ask' && k !== 'intent') q.set(k, v === true ? '1' : v); }); if (SIM) q.set('sim', SIM);
    history.replaceState(null, '', '#' + q.toString());
    if (r.page === 'asset' && r.id) setLastAsset(r.id);
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0 });
  };
  mE(() => { const { ask, intent, ...keep } = route; localStorage.setItem('pe.route', JSON.stringify(keep)); }, [route]);
  mE(() => { const h = () => { const r = parseHash(); if (r) setRoute(r); }; window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  mE(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((p) => !p); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const page = route.page;
  let body;
  if (page === 'home') body = <HomePage b={b} />;
  else if (page === 'assets') body = <AssetSearchPage b={b} />;
  else if (page === 'asset') body = <AssetPage b={b} route={route} reveal={tw.reveal} layout={tw.layout} timeline={tw.timeline} scrollRef={scrollRef} />;
  else if (page === 'jobs') body = <JobsPage b={b} />;
  else if (page === 'job') body = <JobPage b={b} route={route} />;
  else if (page === 'uploads') body = <UploadsPage />;
  else if (page === 'settings') body = <SettingsPage />;
  const chat = page === 'chat';
  return (
    <NavCtx.Provider value={{ route, go, lastAsset, b }}>
      <div className="app">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} mobileOpen={drawer} onClose={() => setDrawer(false)} />
        <div className="col">
          <Topbar onMenu={() => setDrawer(true)} onSearch={() => setPal(true)} />
          <main className={'scroll' + (chat ? ' no-scroll' : '')} ref={scrollRef}>
            {chat ? <ChatPage key={(route.ask || '') + (route.intent || '')} b={b} route={route} /> : <div className="page" key={page + (route.id || '')}>{body}</div>}
          </main>
        </div>
        {pal && <CommandPalette onClose={() => setPal(false)} />}
        <TweaksPanel title="Tweaks">
          <TweakSection label="Treprostinil onboarding" />
          <TweakRadio label="Speed" value={tw.speed} options={['1×', '2×', '4×']} onChange={(v) => setTweak('speed', v)} />
          <TweakButton label="Restart onboarding" onClick={() => setT(0)} />
          <TweakButton label="Skip to ready" secondary onClick={() => setT(AJ.TOTAL)} />
          <TweakSection label="Journey timeline" />
          <TweakRadio label="Style" value={tw.timeline} options={[{ value: 'story', label: 'Tree' }, { value: 'classic', label: 'Classic' }]} onChange={(v) => setTweak('timeline', v)} />
          <TweakRadio label="Scroll reveal" value={tw.reveal} options={['subtle', 'expressive', 'off']} onChange={(v) => setTweak('reveal', v)} />
          <TweakRadio label="Layout" value={tw.layout} options={[{ value: 'rail', label: 'Single rail' }, { value: 'alternate', label: 'Alternating' }]} onChange={(v) => setTweak('layout', v)} />
        </TweaksPanel>
      </div>
    </NavCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PEApp />);
