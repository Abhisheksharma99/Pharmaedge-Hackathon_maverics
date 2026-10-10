import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAssets } from '@/features/assets/api'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { useJobs } from '@/features/jobs/api'
import { jobProgress, runningByAsset } from '@/features/jobs/steps'
import { usePrefs, useSavePrefs } from '@/features/me/api'
import { cn } from '@/lib/utils'
import { mobileNavFocus, useShellStore } from '@/stores/shell-store'
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from './nav-config'

const SECTION_TABS = new Set(
  NAV_GROUPS.flatMap((g) => g.items)
    .map((i) => i.assetTab)
    .filter((t): t is string => !!t && t !== 'overview'),
)

const ITEM =
  'flex h-[32px] items-center gap-[10px] rounded-md px-[10px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
const ITEM_ACTIVE = 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
const GROUP_LABEL = 'px-[10px] pb-[4px] text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground'

/** Where a nav item points, and whether it's the current section. */
function useNavTarget(item: NavItem): { to: string; active: boolean } {
  const { pathname } = useLocation()
  const lastAssetId = useShellStore((s) => s.lastAssetId)
  if (!item.assetTab) {
    const active = item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)
    // Asset pages belong to the asset-scoped items, not to Asset Search.
    return { to: item.to, active: active && !(item.to === '/assets' && pathname !== '/assets') }
  }
  const tab = pathname.match(/^\/assets\/[^/]+\/([^/]+)/)?.[1]
  // A section with its own nav item (Company IR, Conferences) lights that item; every other tab is the journey.
  const active = tab !== undefined && (item.assetTab === 'overview' ? !SECTION_TABS.has(tab) : tab === item.assetTab)
  return { to: lastAssetId ? `/assets/${encodeURIComponent(lastAssetId)}/${item.assetTab}` : '/assets', active }
}

function NavEntry({ item, collapsed, live = false, onNavigate }: { item: NavItem; collapsed: boolean; live?: boolean; onNavigate?: () => void }) {
  const target = useNavTarget(item)
  const link = (
    <Link
      to={target.to}
      onClick={onNavigate}
      aria-current={target.active ? 'page' : undefined}
      className={cn(ITEM, target.active && ITEM_ACTIVE, collapsed && 'justify-center px-0')}
    >
      <item.icon className="size-[16px] shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {!item.ready && <span className="ml-auto rounded-[4px] bg-muted px-[6px] text-[11px] text-muted-foreground">Soon</span>}
          {live && <span role="img" aria-label="A crawl is running" className="ml-auto size-[7px] shrink-0 animate-blink-dot rounded-full bg-primary" />}
        </>
      )}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/** Primary assets (README §5.1): 20px tile, name, build % in warning colour while a crawl runs. */
function YourAssets({ onNavigate }: { onNavigate?: () => void }) {
  const assets = useAssets()
  const running = runningByAsset(useJobs({ status: 'running' }).data)
  const { pathname } = useLocation()
  const primary = (assets.data ?? []).filter((a) => a.kind === 'primary')
  if (assets.isPending) {
    return (
      <div role="status" aria-label="Loading your assets" className="space-y-[2px]">
        <p className={GROUP_LABEL}>Your assets</p>
        {[0, 1].map((i) => (
          <div key={i} className="flex h-[32px] items-center gap-[8px] px-[10px]">
            <Skeleton className="size-[20px] rounded-[6px]" />
            <Skeleton className="h-[12px] flex-1" />
          </div>
        ))}
      </div>
    )
  }
  if (!primary.length) return null
  return (
    <div className="space-y-[2px]">
      <p className={GROUP_LABEL}>Your assets</p>
      {primary.map((a) => {
        const base = `/assets/${encodeURIComponent(a.id)}`
        const active = pathname.startsWith(`${base}/`)
        const job = running.get(a.id)
        return (
          <Link key={a.id} to={`${base}/overview`} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={cn(ITEM, 'gap-[8px]', active && ITEM_ACTIVE)}>
            <AssetTile name={a.name} kind={a.kind} size={20} />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            {job && <span className="font-mono text-[11px] text-warning tabular-nums">{Math.round(jobProgress(job) * 100)}%</span>}
          </Link>
        )
      })}
    </div>
  )
}

function SidebarBody({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const crawling = (useJobs({ status: 'running' }).data?.length ?? 0) > 0
  return (
    <>
      <div className={cn('flex h-[56px] shrink-0 items-center px-[16px]', collapsed && 'justify-center px-0')}>
        <span className="text-[18px] font-semibold tracking-[-0.01em]">
          {collapsed ? (
            <span className="text-primary">PE</span>
          ) : (
            <>
              Pharma<span className="text-primary">Edge</span>
            </>
          )}
        </span>
      </div>
      <nav className="flex-1 space-y-[20px] overflow-y-auto px-[10px] py-[8px]" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-[2px]">
            {!collapsed && <p className={GROUP_LABEL}>{group.label}</p>}
            {group.items.map((item) => (
              <NavEntry key={item.label} item={item} collapsed={collapsed} live={item.to === '/jobs' && crawling} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
        {!collapsed && <YourAssets onNavigate={onNavigate} />}
      </nav>
      <div className="border-t px-[10px] py-[8px]">
        <NavEntry item={SETTINGS_ITEM} collapsed={collapsed} onNavigate={onNavigate} />
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('flex h-[32px] w-full items-center gap-[10px] rounded-md px-[10px] text-muted-foreground hover:bg-sidebar-accent', collapsed && 'justify-center px-0')}
          >
            {collapsed ? <ChevronRight className="size-[16px]" /> : <ChevronLeft className="size-[16px]" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </>
  )
}

/** Collapse state saved per user in /me/prefs: applied once when prefs load; localStorage keeps it otherwise. */
function useCollapsedPref() {
  const prefs = usePrefs()
  const save = useSavePrefs()
  const collapsed = useShellStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useShellStore((s) => s.toggleSidebar)
  const setCollapsed = useShellStore((s) => s.setSidebarCollapsed)
  const synced = useRef(false)
  useEffect(() => {
    if (!prefs.data || synced.current) return
    synced.current = true
    setCollapsed(prefs.data.sidebarCollapsed)
  }, [prefs.data, setCollapsed])
  const toggle = () => {
    synced.current = true
    toggleSidebar()
    save.mutate({ sidebarCollapsed: !collapsed })
  }
  return { collapsed, toggle }
}

export function AppSidebar() {
  const { collapsed, toggle } = useCollapsedPref()
  const mobileOpen = useShellStore((s) => s.mobileNavOpen)
  const setMobileOpen = useShellStore((s) => s.setMobileNavOpen)
  // The drawer is a modal below 900px only: leaving that width (resize, rotate) must not strand its scrim.
  useEffect(() => {
    const wide = window.matchMedia?.('(min-width: 900px)')
    if (!wide) return
    const onChange = (e: MediaQueryListEvent) => e.matches && setMobileOpen(false)
    wide.addEventListener('change', onChange)
    return () => wide.removeEventListener('change', onChange)
  }, [setMobileOpen])

  return (
    <>
      <aside
        className={cn(
          'flex h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 max-[899px]:hidden',
          collapsed ? 'w-[60px]' : 'w-[232px]',
        )}
      >
        <SidebarBody collapsed={collapsed} onToggle={toggle} />
      </aside>
      {/* Below 900px: off-canvas drawer opened from the top bar's menu button. */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(16,24,40,0.3)] data-[state=open]:animate-fade" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onCloseAutoFocus={mobileNavFocus.onCloseAutoFocus}
            className="fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r bg-sidebar shadow-[16px_0_40px_rgba(16,24,40,0.18)] outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:duration-200 data-[state=closed]:duration-150"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <SidebarBody collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
