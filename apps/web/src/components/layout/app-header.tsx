import { LogOut, Search, Settings } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/auth-context'

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

export function AppHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-5">
      {/* Global search across assets, companies, indications and trials arrives with the asset data. */}
      <div
        className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border bg-background px-2.5 text-muted-foreground"
        title="Search becomes available once assets are added"
        aria-disabled="true"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate">Search PharmaEdge</span>
        <kbd className="rounded border bg-card px-1.5 font-mono text-[11px]">⌘K</kbd>
      </div>
      <div className="ml-auto">
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
