import { ArrowRight, ChevronRight, Flag, List, MessageCircle, Sparkle, Star } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { CategoryIcon, IndicationBadges, SignificanceBadge } from '@/features/assets/components/badges'
import { cn } from '@/lib/utils'
import { useJourneyEvents } from '../api'
import { CountdownChip, DetailsGrid, Targets } from '../chips'
import { eventDate } from '../format'
import { eventIndications } from '../indications'
import { CATEGORY_META, noteColor } from '../constants'
import { FOCUS } from '../controls'
import { subtree, subtreeSize, viaLabel, type SubtreeNode } from '../journey-model'
import type { JourneyEventV3 } from '../types'

export interface TreeCardProps {
  assetId: string
  /** id of the title button, for the article's accessible name. */
  titleId?: string
  e: JourneyEventV3
  open: boolean
  onToggle: () => void
  starred: boolean
  nComments: number
  onStar: () => void
  /** Open the event sheet. */
  onOpen: () => void
  /** Jump to a linked event (scroll, flash, open). */
  onJump: (id: string) => void
  /** Events of the current view by id. */
  resolve: (id: string) => JourneyEventV3 | undefined
  className?: string
}

const TITLE = { High: 'text-[21px]', Medium: 'text-[18px]', Low: 'mt-[8px] text-[14.5px] font-semibold' } as const
const PAD = { High: 'px-[24px] py-[22px]', Medium: 'px-[20px] py-[18px]', Low: 'px-[16px] py-[12px]' } as const

/** Tree event card (README §6.2 "Card", SCREENS 10). */
export function TreeCard({ assetId, titleId, e, open, onToggle, starred, nComments, onStar, onOpen, onJump, resolve, className }: TreeCardProps) {
  const meta = CATEGORY_META[e.category] ?? CATEGORY_META.regulatory
  const nodes = subtree(e, resolve)
  const tag = e.user ? noteColor(e.user.tag) : null
  const low = e.significance === 'Low'
  return (
    <div
      className={cn(
        'rounded-2xl border bg-card shadow-panel transition-[box-shadow,border-color] duration-300',
        PAD[e.significance],
        e.is_milestone && 'border-dashed bg-[color-mix(in_srgb,var(--background)_50%,var(--card))]',
        tag && 'border-solid border-[var(--tc)] bg-[linear-gradient(color-mix(in_srgb,var(--tc)_5%,#fff),#fff_70px)]',
        starred && 'shadow-[inset_0_0_0_2px_var(--star),0_1px_2px_rgba(16,24,40,0.04)]',
        className,
      )}
      style={tag ? ({ '--tc': tag } as CSSProperties) : undefined}
    >
      {e.user && (
        <div className="-mt-[4px] mb-[10px] flex items-center gap-[6px] text-[12px]" style={{ color: tag! }}>
          <Flag className="size-[12px]" aria-hidden="true" />
          <b className="font-semibold">{e.user.tag}</b>
          <span className="text-muted-foreground">
            {e.user.mode === 'ai' ? 'Found by Asset AI from' : 'Added by'} {e.user.by.name}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-[10px]">
        <CategoryIcon category={e.category} />
        <span className="flex flex-col leading-tight">
          <b className="text-[12.5px]" style={{ color: meta.color }}>
            {meta.label}
          </b>
          <span className="text-[11.5px] text-muted-foreground capitalize">{e.type.replace(/_/g, ' ')}</span>
        </span>
        <IndicationBadges items={eventIndications(e)} max={2} />
        <span className="flex-1" />
        <span className="font-mono text-[12px] text-text-secondary">{eventDate(e)}</span>
        {e.is_milestone && <CountdownChip date={e.date} />}
        <SignificanceBadge value={e.significance} />
      </div>
      <h3 className={cn('mt-[12px] leading-tight font-[650] tracking-[-0.015em] text-balance', TITLE[e.significance])}>
        <button type="button" id={titleId} onClick={onOpen} className={cn('rounded-sm text-left text-balance hover:text-primary', FOCUS)}>
          {e.title}
        </button>
      </h3>
      {e.summary && <p className="mt-[6px] leading-[1.55] text-pretty text-text-secondary">{e.summary}</p>}
      <div className="mt-[12px] empty:hidden">
        <Targets e={e} label />
      </div>
      {!low && <DetailsGrid details={e.details} className="mt-[12px]" />}
      {!low && e.impact && (
        <p className="mt-[10px] leading-normal text-secondary-foreground">
          <b className="font-semibold text-foreground">Why it matters · </b>
          {e.impact}
        </p>
      )}
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t border-hair pt-[10px]">
        <span className={cn('inline-flex items-center gap-[4px] text-[11.5px] whitespace-nowrap text-muted-foreground', e.via === 'ai_events' && 'text-violet')}>
          {e.via === 'ai_events' && <Sparkle className="size-[11px]" aria-hidden="true" />}
          {viaLabel(e)}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={starred}
          aria-label="Mark as important"
          title="Mark as important"
          onClick={onStar}
          className={cn('inline-flex size-[28px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS, starred && 'text-star-stroke')}
        >
          <Star className={cn('size-[14px]', starred && 'fill-star')} />
        </button>
        <button type="button" aria-label={`Comments (${nComments})`} title="Comments" onClick={onOpen} className={cn('inline-flex h-[28px] min-w-[28px] items-center justify-center gap-[4px] rounded-lg px-[6px] text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS)}>
          <MessageCircle className="size-[14px]" />
          {nComments > 0 && <span className="font-mono">{nComments}</span>}
        </button>
        {nodes.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className={cn('inline-flex h-[28px] items-center gap-[6px] rounded-lg border bg-card px-[10px] text-[12.5px] font-medium text-secondary-foreground hover:bg-accent', FOCUS, open && 'border-primary bg-primary-soft text-primary hover:bg-primary-soft')}
          >
            <List className="size-[13px]" aria-hidden="true" />
            {open ? 'Hide subtree' : 'Subtree'}
            <span className="font-mono text-[11px] text-muted-foreground">{subtreeSize(nodes)}</span>
          </button>
        )}
        <button type="button" onClick={onOpen} className={cn('inline-flex h-[28px] items-center gap-[6px] rounded-lg border border-[#c7d1f4] bg-card px-[10px] text-[12.5px] font-medium text-primary hover:bg-primary-soft', FOCUS)}>
          Details <ArrowRight className="size-[12px]" />
        </button>
      </div>
      {open && <Subtree assetId={assetId} e={e} resolve={resolve} onJump={onJump} />}
    </div>
  )
}

/** Opened subtree; linked events the current view doesn't hold are looked up in "All" (loaded only when needed). */
function Subtree({ assetId, e, resolve, onJump }: { assetId: string; e: JourneyEventV3; resolve: (id: string) => JourneyEventV3 | undefined; onJump: (id: string) => void }) {
  const missing = (e.links ?? []).some((id) => !resolve(id))
  const all = useJourneyEvents(assetId, 'all', { enabled: missing }).data?.events
  const allById = new Map((all ?? []).map((x) => [x.id, x]))
  const nodes = subtree(e, (id) => resolve(id) ?? allById.get(id))
  return (
    <ul aria-label="Subtree" className="mt-[12px] animate-fade-up rounded-xl border border-hair bg-background py-[8px] pr-[8px] pl-[4px]">
      {nodes.map((n, i) => (
        <SubtreeItem key={i} node={n} depth={0} onJump={onJump} />
      ))}
    </ul>
  )
}

const ELBOW =
  "relative pl-[16px] before:absolute before:top-0 before:left-0 before:h-[15px] before:w-[12px] before:rounded-bl-[7px] before:border-b-[1.5px] before:border-l-[1.5px] before:border-[#d0d5dd] before:content-[''] [&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:top-[15px] [&:not(:last-child)]:after:bottom-0 [&:not(:last-child)]:after:left-0 [&:not(:last-child)]:after:border-l-[1.5px] [&:not(:last-child)]:after:border-[#d0d5dd] [&:not(:last-child)]:after:content-['']"

function SubtreeItem({ node, depth, onJump }: { node: SubtreeNode; depth: number; onJump: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 1)
  const kids = node.children?.length ? node.children : null
  return (
    <li className={cn('animate-fade-up', depth > 0 && ELBOW)}>
      <button
        type="button"
        aria-expanded={kids ? open : undefined}
        onClick={() => (kids ? setOpen(!open) : node.eventId && onJump(node.eventId))}
        className={cn('group flex w-full min-w-0 items-center gap-[7px] rounded-md px-[6px] py-[4px] text-left text-[12.5px] text-secondary-foreground hover:bg-card', FOCUS, !kids && !node.eventId && 'cursor-default')}
      >
        {kids ? (
          <span className="flex size-[16px] shrink-0 items-center justify-center rounded border bg-card text-text-secondary">
            <ChevronRight className={cn('size-[11px] transition-transform', open && 'rotate-90')} aria-hidden="true" />
          </span>
        ) : (
          <span aria-hidden="true" className="mx-[4px] size-[7px] shrink-0 rounded-full bg-faint" style={node.color ? { background: node.color } : undefined} />
        )}
        <span className={cn('min-w-0 truncate text-foreground', node.mono && 'font-mono text-[11.5px]', node.eventId && 'group-hover:text-primary')}>{node.label}</span>
        {node.sub && <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">{node.sub}</span>}
        {kids && <span className="ml-auto rounded border border-hair bg-card px-[4px] font-mono text-[10.5px] text-muted-foreground">{kids.length}</span>}
        {node.eventId && <ArrowRight className="ml-auto size-[12px] shrink-0 text-primary" aria-hidden="true" />}
      </button>
      {kids && open && (
        <ul className="ml-[14px]">
          {kids.map((c, i) => (
            <SubtreeItem key={i} node={c} depth={depth + 1} onJump={onJump} />
          ))}
        </ul>
      )}
    </li>
  )
}
