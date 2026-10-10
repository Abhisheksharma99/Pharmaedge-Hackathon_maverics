import { LogOut, Menu, Plus, Search, Settings } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/auth-context'
import { useShellStore } from '@/stores/shell-store'
import { CrawlChip } from './crawl-chip'
import { NotificationsPopover } from './notifications-popover'

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

const MENU_ITEM = 'gap-[8px] rounded-none px-[14px] py-[9px] text-secondary-foreground focus:bg-background focus:text-secondary-foreground'

/** Top bar (README §5.1): menu (<900px), ⌘K search, crawl status, Add asset, notifications, account. */
export function AppHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen)
  const setMobileNavOpen = useShellStore((s) => s.setMobileNavOpen)
  if (!user) return null

  return (
    <header className="flex h-[56px] shrink-0 items-center gap-[10px] border-b bg-card px-[12px] min-[900px]:gap-[16px] min-[900px]:px-[20px]">
      <Button variant="ghost" size="icon" className="text-text-secondary min-[900px]:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
        <Menu className="size-[18px]" />
      </Button>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search (⌘K)"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-[32px] min-w-[150px] shrink-0 items-center gap-[8px] rounded-md border bg-background px-[10px] text-muted-foreground transition-colors hover:border-input min-[900px]:w-full min-[900px]:max-w-[440px] min-[900px]:shrink"
      >
        <Search className="size-[15px] shrink-0" />
        <span className="flex-1 truncate text-left max-[899px]:hidden">Search assets, events, trials…</span>
        <kbd className="rounded-[4px] border bg-card px-[5px] font-mono text-[11px] max-[899px]:hidden">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-[10px]">
        <CrawlChip />
        <Button asChild size="sm" className="max-[899px]:hidden">
          <Link to="/chat?intent=add">
            <Plus /> Add asset
          </Link>
        </Button>
        <NotificationsPopover />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-[8px] rounded-[8px] px-[6px] py-[4px] font-medium outline-none hover:bg-accent data-[state=open]:bg-accent focus-visible:ring-[3px] focus-visible:ring-primary/12" aria-label="Account menu">
            <Avatar className="size-[28px]">
              <AvatarFallback className="bg-primary text-[11px] font-semibold text-primary-foreground">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="whitespace-nowrap max-[899px]:hidden">{user.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-[230px] rounded-[12px] border border-border p-0 shadow-popover ring-0">
            <DropdownMenuLabel className="flex flex-col gap-[1px] border-b border-hair px-[14px] py-[12px] text-[13px] text-foreground">
              <b className="truncate font-semibold">{user.name}</b>
              <span className="truncate font-normal text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuItem className={MENU_ITEM} onSelect={() => navigate('/settings')}>
              <Settings className="size-[14px]" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem className={MENU_ITEM} onSelect={() => void logout()}>
              <LogOut className="size-[14px]" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
