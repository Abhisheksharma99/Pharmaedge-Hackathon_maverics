import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useShellStore } from '@/stores/shell-store'
import { NAV_GROUPS, SETTINGS_ITEM, type NavItem } from './nav-config'

const SECTION_TABS = new Set(
  NAV_GROUPS.flatMap((g) => g.items)
    .map((i) => i.assetTab)
    .filter((t): t is string => !!t && t !== 'overview'),
)

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

function NavEntry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const target = useNavTarget(item)
  const link = (
    <Link
      to={target.to}
      aria-current={target.active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        target.active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {!item.ready && (
            <span className="ml-auto rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">Soon</span>
          )}
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

export function AppSidebar() {
  const collapsed = useShellStore((s) => s.sidebarCollapsed)
  const toggle = useShellStore((s) => s.toggleSidebar)

  return (
    <aside
      className={cn(
        'flex h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200',
        collapsed ? 'w-[60px]' : 'w-[232px]',
      )}
    >
      <div className={cn('flex h-14 items-center px-4', collapsed && 'justify-center px-0')}>
        <span className="text-lg font-semibold tracking-tight">
          {collapsed ? (
            <span className="text-primary">PE</span>
          ) : (
            <>
              Pharma<span className="text-primary">Edge</span>
            </>
          )}
        </span>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-2" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-0.5">
            {!collapsed && (
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            )}
            {group.items.map((item) => (
              <NavEntry key={item.label} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t px-2.5 py-2">
        <NavEntry item={SETTINGS_ITEM} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-muted-foreground hover:bg-sidebar-accent',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
