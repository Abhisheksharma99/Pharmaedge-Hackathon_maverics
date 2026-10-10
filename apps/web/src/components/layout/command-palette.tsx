import { Command as CommandPrimitive } from 'cmdk'
import { Activity, ArrowRight, Home, Plus, Route, Search, Settings, Sparkle, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Command, CommandGroup, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { assetMatches, byKindThenName, useAssets } from '@/features/assets/api'
import { AssetTile } from '@/features/assets/components/asset-tile'
import { eventIndications } from '@/features/journey/indications'
import { CATEGORY_META } from '@/features/journey/constants'
import { SEARCH_MIN_CHARS, useSearch } from '@/features/search/api'
import { formatDay } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import { paletteFocus, useShellStore } from '@/stores/shell-store'

interface PaletteItem {
  /** Unique cmdk value; the palette filters its own rows (shouldFilter is off). */
  value: string
  label: string
  sub: string
  icon?: LucideIcon
  asset?: { name: string; kind: 'primary' | 'competitor' }
  run: () => void
}

const PAGES: { label: string; to: string; icon: LucideIcon }[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Asset Search', to: '/assets', icon: Search },
  { label: 'Asset AI', to: '/chat', icon: Sparkle },
  { label: 'Crawl jobs', to: '/jobs', icon: Activity },
  { label: 'Settings', to: '/settings', icon: Settings },
]

const GROUP_HEADING =
  '**:[[cmdk-group-heading]]:px-[10px] **:[[cmdk-group-heading]]:pt-[8px] **:[[cmdk-group-heading]]:pb-[4px] **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:tracking-[0.06em] **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:uppercase'

/** ⌘K palette (README §5.1): assets, events (from 2 characters, via /search), pages and actions. */
export function CommandPalette() {
  const open = useShellStore((s) => s.paletteOpen)
  const setOpen = useShellStore((s) => s.setPaletteOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={paletteFocus.onCloseAutoFocus}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-[14px] p-0 shadow-dialog min-[761px]:max-w-[620px]"
      >
        <DialogTitle className="sr-only">Search PharmaEdge</DialogTitle>
        <DialogDescription className="sr-only">Search assets, events, NCT IDs and pages, or run an action.</DialogDescription>
        <PaletteBody onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** Mounted only while the palette is open, so every opening starts with an empty query. */
function PaletteBody({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const openEvent = useEventSheet((s) => s.openEvent)
  const assets = useAssets()
  const [q, setQ] = useState('')
  /** Row the user moved to (arrows or pointer) since the last keystroke; null = the first row. */
  const [picked, setPicked] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())
  const term = q.trim()
  const lower = term.toLowerCase()
  const search = useSearch(term)

  const go = (to: string) => {
    onDone()
    navigate(to)
  }

  const assetItems: PaletteItem[] = (assets.data ?? [])
    .filter((a) => !term || assetMatches(a, term))
    .sort(byKindThenName)
    .slice(0, 6)
    .map((a) => ({
      value: `asset:${a.id}`,
      label: a.name,
      sub: [...a.aliases, a.company.name].filter(Boolean).join(' · ') + (a.kind === 'competitor' ? ' · competitor' : ''),
      asset: { name: a.name, kind: a.kind },
      run: () => go(`/assets/${encodeURIComponent(a.id)}/overview`),
    }))
  const eventItems: PaletteItem[] =
    term.length < SEARCH_MIN_CHARS
      ? []
      : (search.data?.events ?? []).map((e) => ({
          value: `event:${e.asset}:${e.id}`,
          label: e.title,
          sub: [e.assetName, eventIndications(e).join(', '), formatDay(e.date), e.nct_id].filter(Boolean).join(' · '),
          icon: CATEGORY_META[e.category]?.icon ?? Route,
          run: () => {
            onDone()
            openEvent(e.asset, e.id)
          },
        }))
  const pageItems: PaletteItem[] = PAGES.filter((p) => !term || p.label.toLowerCase().includes(lower)).map((p) => ({
    value: `page:${p.to}`,
    label: p.label,
    sub: 'Page',
    icon: p.icon,
    run: () => go(p.to),
  }))
  const actionItems: PaletteItem[] = [
    { value: 'action:add', label: 'Add an asset', sub: 'Action', icon: Plus, run: () => go('/chat?intent=add') },
    {
      value: 'action:ask',
      label: term ? `Ask Asset AI: “${term}”` : 'Ask Asset AI',
      sub: 'Action',
      icon: Sparkle,
      run: () => go(term ? `/chat?ask=${encodeURIComponent(term)}` : '/chat'),
    },
  ].filter((a) => !term || a.value === 'action:ask' || a.label.toLowerCase().includes(lower))

  const groups: [string, PaletteItem[]][] = [
    ['Assets', assetItems],
    ['Events', eventItems],
    ['Pages', pageItems],
    ['Actions', actionItems],
  ]
  const visible = groups.filter(([, items]) => items.length > 0)
  const values = visible.flatMap(([, items]) => items.map((i) => i.value))
  // The first row stays highlighted until the user moves, also when /search results arrive after the debounce.
  const selected = picked !== null && values.includes(picked) ? picked : (values[0] ?? '')

  useEffect(() => {
    itemRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // cmdk skips its own arrow handling when the event is already handled here.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!values.length) return
    const i = values.indexOf(selected)
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? values.length - 1 : null
    if (to === null) return
    e.preventDefault()
    setPicked(values[(to + values.length) % values.length])
  }

  return (
    <Command
      label="Search PharmaEdge"
      shouldFilter={false}
      disablePointerSelection
      vimBindings={false}
      value={selected}
      onKeyDown={onKeyDown}
      className="rounded-none! bg-card p-0"
    >
      <div className="flex items-center gap-[10px] border-b border-hair px-[16px] py-[14px] text-muted-foreground">
        <Search className="size-[17px] shrink-0" />
        <CommandPrimitive.Input
          autoFocus
          value={q}
          onValueChange={(v) => {
            setQ(v)
            setPicked(null)
          }}
          placeholder="Search assets, events, NCT IDs, pages…"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Kbd>esc</Kbd>
      </div>
      <CommandList className="max-h-[min(420px,56vh)] p-[6px]">
        {visible.map(([heading, items]) => (
          <CommandGroup key={heading} heading={heading} className={cn('p-0', GROUP_HEADING)}>
            {items.map((it) => (
              <CommandPrimitive.Item
                key={it.value}
                value={it.value}
                onSelect={() => it.run()}
                onMouseEnter={() => setPicked(it.value)}
                ref={(el) => {
                  if (el) itemRefs.current.set(it.value, el)
                  else itemRefs.current.delete(it.value)
                }}
                className="group flex cursor-pointer items-center gap-[10px] rounded-lg px-[10px] py-[8px] outline-none data-[selected=true]:bg-primary-soft"
              >
                {it.asset ? (
                  <AssetTile name={it.asset.name} kind={it.asset.kind} size={24} />
                ) : (
                  <span aria-hidden="true" className="flex size-[24px] shrink-0 items-center justify-center rounded-[7px] bg-muted text-text-secondary">
                    {it.icon && <it.icon className="size-[14px]" />}
                  </span>
                )}
                <span className="min-w-0 truncate font-medium">{it.label}</span>
                <span className="ml-auto max-w-[45%] shrink-0 truncate text-[12px] text-muted-foreground">{it.sub}</span>
                <ArrowRight aria-hidden="true" className="size-[13px] shrink-0 text-primary opacity-0 group-data-[selected=true]:opacity-100" />
              </CommandPrimitive.Item>
            ))}
          </CommandGroup>
        ))}
        {assets.isPending && (
          <p role="status" className="px-[10px] py-[8px] text-[12px] text-muted-foreground">
            Loading assets…
          </p>
        )}
        {term.length >= SEARCH_MIN_CHARS && search.isFetching && eventItems.length === 0 && (
          <p role="status" className="px-[10px] py-[8px] text-[12px] text-muted-foreground">
            Searching events…
          </p>
        )}
        {term.length >= SEARCH_MIN_CHARS && search.isError && (
          <p role="alert" className="flex items-center gap-[10px] px-[10px] py-[8px] text-[12px] text-destructive">
            Events couldn't be searched.
            <button type="button" onClick={() => void search.refetch()} className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none">
              Try again
            </button>
          </p>
        )}
        {term.length >= SEARCH_MIN_CHARS && search.isSuccess && !search.isFetching && eventItems.length === 0 && assetItems.length === 0 && (
          <p role="status" className="px-[10px] py-[8px] text-[12px] text-muted-foreground">
            No assets or events match “{term}”.
          </p>
        )}
      </CommandList>
      <div className="flex gap-[16px] border-t border-hair px-[16px] py-[9px] text-[12px] text-muted-foreground">
        <span className="flex items-center gap-[4px]">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-[4px]">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-[4px]">
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </Command>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[4px] border bg-card px-[5px] font-mono text-[11px] text-muted-foreground">{children}</kbd>
}
