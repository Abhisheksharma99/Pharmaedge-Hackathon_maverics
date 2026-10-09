import { LogOut, Menu, Plus, Search, Settings } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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

/** Top bar (README §5.1): menu (<900px), ⌘K search, crawl status, Add asset, notifications, account. */
export function AppHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen)
  const setMobileNavOpen = useShellStore((s) => s.setMobileNavOpen)
  if (!user) return null

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b bg-card px-3 min-[900px]:gap-4 min-[900px]:px-5">
      <Button variant="ghost" size="icon" className="min-[900px]:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
        <Menu className="size-[18px]" />
      </Button>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search (⌘K)"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-8 shrink-0 items-center gap-2 rounded-md border bg-background px-2.5 text-muted-foreground transition-colors hover:border-input min-[900px]:w-full min-[900px]:max-w-[440px] min-[900px]:shrink"
      >
        <Search className="size-[15px] shrink-0" />
        <span className="flex-1 truncate text-left max-[899px]:hidden">Search assets, events, trials…</span>
        <kbd className="rounded border bg-card px-1.5 font-mono text-[11px] max-[899px]:hidden">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2.5">
        <CrawlChip />
        <Button asChild size="sm" className="max-[899px]:hidden">
          <Link to="/chat?intent=add">
            <Plus /> Add asset
          </Link>
        </Button>
        <NotificationsPopover />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent" aria-label="Account menu">
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary text-[11px] text-primary-foreground">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden font-medium sm:inline">{user.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="truncate font-medium">{user.name}</p>
              <p className="truncate font-normal text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/settings')}>
              <Settings /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
