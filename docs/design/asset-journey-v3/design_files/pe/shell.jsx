const { useState: sS, useEffect: sE, useRef: sR, useMemo: sM, useContext: sC, createContext } = React;

const NavCtx = createContext(null);
const useNav = () => sC(NavCtx);

function eventsFor(id, b) {
  if (id === 'treprostinil') return (b.phase === 'done' ? AJ.EVENTS : b.events).map((e) => ({ ...e, asset: 'treprostinil' }));
  return PE.EV.filter((e) => e.asset === id);
}
const allEvents = (b) => [...eventsFor('treprostinil', b), ...PE.EV];
const daysFrom = (d) => Math.round((new Date(d) - new Date(AJ.TODAY)) / 864e5);

function AssetTile({ a, size = 28 }) {
  return <span className={'a-tile' + (a.kind === 'competitor' ? ' comp' : '')} style={{ width: size, height: size, fontSize: size * 0.42 }}>{a.name.slice(0, 2)}</span>;
}

const SB_NAV = [
  ['Workspace', [['home', 'Home', { page: 'home' }], ['search', 'Asset Search', { page: 'assets' }], ['sparkles', 'Asset AI', { page: 'chat' }]]],
  ['Intelligence', [['route', 'Asset Journey', { page: 'asset', tab: 'overview' }], ['building', 'Company IR', { page: 'asset', tab: 'company-ir' }], ['calendar', 'Conferences', { page: 'asset', tab: 'conferences' }]]],
  ['Data', [['upload', 'Uploads', { page: 'uploads' }, true], ['activity', 'Crawl jobs', { page: 'jobs' }]]],
];
function navActive(r, to) {
  if (to.page === 'asset') return r.page === 'asset' && (to.tab === 'overview' ? !['company-ir', 'conferences'].includes(r.tab) : r.tab === to.tab);
  if (to.page === 'jobs') return r.page === 'jobs' || r.page === 'job';
  return r.page === to.page;
}

function Sidebar({ collapsed, onToggle, mobileOpen, onClose }) {
  const { route, go, lastAsset, b } = useNav();
  const nav = (to) => { go(to.page === 'asset' ? { ...to, id: lastAsset } : to); onClose && onClose(); };
  return (
    <>
      {mobileOpen && <div className="sb-ov" onClick={onClose}></div>}
      <aside className={'sb' + (collapsed ? ' col' : '') + (mobileOpen ? ' open' : '')}>
        <div className="sb-logo">{collapsed ? <span className="pri">PE</span> : <>Pharma<span className="pri">Edge</span></>}</div>
        <nav className="sb-nav" aria-label="Main">
          {SB_NAV.map(([g, items]) => (
            <div key={g} className="sb-grp">{!collapsed && <p>{g}</p>}
              {items.map(([ic, l, to, soon]) => {
                const on = navActive(route, to);
                return <button key={l} type="button" title={collapsed ? l : undefined} onClick={() => nav(to)} className={'sb-item' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined}><Icon name={ic} size={16} />{!collapsed && <><span>{l}</span>{soon && <span className="sb-soon">Soon</span>}{l === 'Crawl jobs' && b.phase !== 'done' && <span className="sb-live"></span>}</>}</button>;
              })}
            </div>
          ))}
          {!collapsed && (
            <div className="sb-grp"><p>Your assets</p>
              {PE.ASSETS.filter((a) => a.kind === 'primary').map((a) => {
                const on = route.page === 'asset' && route.id === a.id;
                const building = a.id === 'treprostinil' && b.phase !== 'done';
                return <button key={a.id} type="button" className={'sb-item sb-asset' + (on ? ' on' : '')} onClick={() => { go({ page: 'asset', id: a.id, tab: 'overview' }); onClose && onClose(); }}><AssetTile a={a} size={20} /><span>{a.name}</span>{building && <span className="sb-pct mono">{Math.round(b.progress * 100)}%</span>}</button>;
              })}
            </div>
          )}
        </nav>
        <div className="sb-foot">
          <button type="button" className={'sb-item' + (route.page === 'settings' ? ' on' : '')} onClick={() => nav({ page: 'settings' })}><Icon name="settings" size={16} />{!collapsed && <span>Settings</span>}</button>
          <button type="button" className="sb-item muted sb-collapse" onClick={onToggle}><Icon name={collapsed ? 'chevR' : 'chevL'} size={16} />{!collapsed && <span>Collapse</span>}</button>
        </div>
      </aside>
    </>
  );
}

function ProgressRing({ p, size = 18 }) {
  const r = (size - 4) / 2, c = 2 * Math.PI * r;
  return <svg width={size} height={size} className="ring"><circle cx={size / 2} cy={size / 2} r={r} stroke="#d5ddfa" strokeWidth="2.5" fill="none" /><circle cx={size / 2} cy={size / 2} r={r} stroke="#2347d9" strokeWidth="2.5" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - p)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} /></svg>;
}

function Topbar({ onMenu, onSearch }) {
  const { go, b } = useNav();
  const [bell, setBell] = sS(false);
  const [notifs, setNotifs] = sS(PE.NOTIFS);
  const [me, setMe] = sS(false);
  const unread = notifs.filter((n) => n.unread).length;
  sE(() => { const c = () => { setBell(false); setMe(false); }; window.addEventListener('click', c); return () => window.removeEventListener('click', c); }, []);
  const building = b.phase !== 'done';
  return (
    <header className="hdr">
      <button className="icon-btn hdr-menu" aria-label="Open navigation" onClick={onMenu}><Icon name="menu" size={18} /></button>
      <button type="button" className="search" onClick={onSearch}><Icon name="search" size={15} /><span>Search assets, events, trials…</span><kbd>⌘K</kbd></button>
      <div className="hdr-r">
        {building ? (
          <button type="button" className="crawl-chip" onClick={() => go({ page: 'asset', id: 'treprostinil', tab: 'overview' })} title="Open the live build">
            <ProgressRing p={b.progress} /><span><b>Treprostinil</b>{` · ${b.phase === 'planning' ? 'planning' : b.current ? b.current.short : ''}`}</span><span className="mono">{Math.round(b.progress * 100)}%</span>
          </button>
        ) : <span className="crawl-ok"><Icon name="check" size={13} sw={2.6} />All crawls finished</span>}
        <button className="btn btn-sm btn-p hdr-add" onClick={() => go({ page: 'chat', intent: 'add' })}><Icon name="plus" size={14} />Add asset</button>
        <div className="pop-w" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" aria-label={`Notifications, ${unread} unread`} onClick={() => { setBell(!bell); setMe(false); }}><Icon name="bell" size={17} />{unread > 0 && <span className="badge-n">{unread}</span>}</button>
          {bell && (
            <div className="pop notif">
              <div className="pop-h"><b>Notifications</b><button className="link" onClick={() => setNotifs(notifs.map((n) => ({ ...n, unread: false })))}>Mark all read</button></div>
              {notifs.map((n) => (
                <button key={n.id} className={'notif-i' + (n.unread ? ' un' : '')} onClick={() => { setNotifs(notifs.map((x) => x.id === n.id ? { ...x, unread: false } : x)); setBell(false); go(n.go); }}>
                  <span className="tile sm"><Icon name={n.icon} size={14} /></span><span className="nt"><b>{n.t}</b><span>{n.s}</span></span><span className="nw">{n.when}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pop-w" onClick={(e) => e.stopPropagation()}>
          <button className="me" onClick={() => { setMe(!me); setBell(false); }} aria-label="Account menu"><span className="av">AM</span><span className="me-n">{PE.USER.name}</span></button>
          {me && (
            <div className="pop menu">
              <div className="pop-h col"><b>{PE.USER.name}</b><span>{PE.USER.email}</span></div>
              <button className="menu-i" onClick={() => { setMe(false); go({ page: 'settings' }); }}><Icon name="settings" size={14} />Settings</button>
              <button className="menu-i"><Icon name="logout" size={14} />Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function CommandPalette({ onClose }) {
  const { go, b } = useNav();
  const [q, setQ] = sS('');
  const [i, setI] = sS(0);
  const inp = sR(null);
  sE(() => { inp.current && inp.current.focus(); }, []);
  const groups = sM(() => {
    const m = (s) => !q || s.toLowerCase().includes(q.toLowerCase());
    const pages = [['home', 'Home', { page: 'home' }], ['search', 'Asset Search', { page: 'assets' }], ['sparkles', 'Asset AI', { page: 'chat' }], ['activity', 'Crawl jobs', { page: 'jobs' }], ['settings', 'Settings', { page: 'settings' }]]
      .filter(([, l]) => m(l)).map(([ic, l, to]) => ({ k: 'p' + l, ic, l, sub: 'Page', to }));
    const assets = PE.ASSETS.filter((a) => m(a.name + ' ' + (a.brand || '') + ' ' + a.company + ' ' + a.indications.join(' '))).map((a) => ({ k: 'a' + a.id, a, l: a.name, sub: `${a.brand ? a.brand + ' · ' : ''}${a.company}${a.kind === 'competitor' ? ' · competitor' : ''}`, to: { page: 'asset', id: a.id, tab: 'overview' } }));
    const evs = q.length < 2 ? [] : allEvents(b).filter((e) => m(e.title + ' ' + (e.nct_id || ''))).slice(0, 6).map((e) => ({ k: 'e' + e.asset + e.id, ic: AJ.CAT[e.category].icon, l: e.title, sub: `${PE.byId[e.asset].name} · ${fmtDate(e.date)}`, to: { page: 'asset', id: e.asset, tab: 'overview' } }));
    const acts = [['plus', 'Add an asset', { page: 'chat', intent: 'add' }], ['sparkles', `Ask Asset AI${q ? `: “${q}”` : ''}`, { page: 'chat', ask: q || undefined }]].filter(([, l]) => !q || l.toLowerCase().includes('ask') || m(l)).map(([ic, l, to]) => ({ k: 'x' + l, ic, l, sub: 'Action', to }));
    return [['Assets', assets.slice(0, 6)], ['Events', evs], ['Pages', pages], ['Actions', acts]].filter(([, xs]) => xs.length);
  }, [q, b.events.length]);
  const flat = groups.flatMap(([, xs]) => xs);
  const pick = (it) => { onClose(); go(it.to); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(flat.length - 1, x + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    if (e.key === 'Enter' && flat[i]) pick(flat[i]);
    if (e.key === 'Escape') onClose();
  };
  let n = -1;
  return ReactDOM.createPortal(
    <div className="pal-ov" onMouseDown={onClose}>
      <div className="pal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="pal-in"><Icon name="search" size={17} /><input ref={inp} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={key} placeholder="Search assets, events, NCT IDs, pages…" /><kbd>esc</kbd></div>
        <div className="pal-l">
          {groups.map(([g, xs]) => (
            <div key={g}><p className="pal-g">{g}</p>
              {xs.map((it) => { n++; const idx = n; return (
                <button key={it.k} className={'pal-i' + (idx === i ? ' on' : '')} onMouseEnter={() => setI(idx)} onClick={() => pick(it)}>
                  {it.a ? <AssetTile a={it.a} size={24} /> : <span className="pal-ic"><Icon name={it.ic} size={14} /></span>}
                  <span className="pal-t">{it.l}</span><span className="pal-s">{it.sub}</span>{idx === i && <Icon name="arrowR" size={13} className="pal-go" />}
                </button>
              ); })}
            </div>
          ))}
          {!flat.length && <p className="pal-empty">No matches for “{q}”</p>}
        </div>
        <div className="pal-f"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
      </div>
    </div>, document.body);
}

Object.assign(window, { NavCtx, useNav, eventsFor, allEvents, daysFrom, AssetTile, Sidebar, Topbar, CommandPalette, ProgressRing });
