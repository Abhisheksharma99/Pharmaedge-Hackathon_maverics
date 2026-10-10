import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw, Route, Star, X } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { RecordTab } from '@/features/assets/api'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { RecordSheet } from '@/features/assets/components/record-sheet'
import { formatPhase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { eventSheetFocus, useEventSheet, type OpenEvent } from '@/stores/event-sheet-store'
import { useAnnotations, useToggleStar } from './annotations-api'
import { useBranches, useEvent, useJourneyEvents } from './api'
import { BranchChip, CountdownChip, DetailsGrid, NoteTagChip, Targets } from './chips'
import { eventDate } from './format'
import { CATEGORY_META } from './constants'
import { BTN_SM, FOCUS, ICON_BTN } from './controls'
import { branchModel, chronological, laneOf } from './journey-model'
import { BranchLineage } from './sheet/branch-lineage'
import { Comments } from './sheet/comments'
import { Evidence } from './sheet/evidence'
import { PositionStrip } from './sheet/position-strip'
import { RecordTerms } from './sheet/record-terms'
import { RegulatoryPath } from './sheet/regulatory-path'
import { SheetSection } from './sheet/sheet-section'

/** Keys typed into a field never navigate or close the sheet (README §6.4 "ignored inside inputs"). */
const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

const enc = encodeURIComponent

/**
 * The comprehensive event sheet (README §6.4), opened from any surface through the event-sheet store. Prev/next follow
 * the API's neighbours (key events for a key event); on the asset's own Overview they also scroll the journey.
 */
export function EventDetailSheet({ current, onClose }: { current: OpenEvent | null; onClose: () => void }) {
  // Keep the last event while the sheet animates out, so it never flashes "Loading…".
  const [shown, setShown] = useState<OpenEvent | null>(current)
  const [record, setRecord] = useState<{ eventId: string; tab: RecordTab; key: string } | null>(null)
  if (current && (current.assetId !== shown?.assetId || current.eventId !== shown?.eventId)) {
    setShown(current)
    setRecord(null)
  }
  // A record opened from one event never reappears for the next one, nor after the sheet closed.
  if (!current && record) setRecord(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const open = current !== null
  const assetId = shown?.assetId ?? ''
  const eventId = shown?.eventId ?? null
  const detail = useEvent(assetId, eventId)
  const event = detail.data?.event
  const title = event?.title ?? (detail.isError ? 'Event unavailable' : 'Loading…')

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || isTypingTarget(e.target)) return
    const n = detail.data?.neighbors
    const target = e.key === 'ArrowLeft' ? n?.prev : e.key === 'ArrowRight' ? n?.next : null
    if (target) {
      e.preventDefault()
      go(assetId, target.id)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent
          ref={contentRef}
          showCloseButton={false}
          onCloseAutoFocus={eventSheetFocus.onCloseAutoFocus}
          onEscapeKeyDown={(e) => {
            // Esc in the comment box leaves the box (keeping the draft); the next Esc closes the sheet.
            if (isTypingTarget(document.activeElement)) {
              e.preventDefault()
              contentRef.current?.focus()
            }
          }}
          onKeyDown={onKeyDown}
          className="gap-0 shadow-sheet data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]"
        >
          <div className="flex items-center justify-between gap-[12px] border-b border-hair px-[18px] py-[14px]">
            <div className="flex min-w-0 flex-wrap items-center gap-[8px] font-semibold">
              {event && (
                <>
                  <CategoryIcon category={event.category} />
                  <span>{CATEGORY_META[event.category]?.label ?? event.category}</span>
                  <HeaderBranch assetId={assetId} branch={event.branch} />
                  {event.user && <NoteTagChip tag={event.user.tag} />}
                </>
              )}
            </div>
            <div className="flex shrink-0 gap-[2px]">
              {event && <StarButton assetId={assetId} eventId={event.id} />}
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} className={ICON_BTN}>
                <X className="size-[16px]" />
              </Button>
            </div>
          </div>
          <div key={event?.id ?? ''} className={cn('flex-1 animate-fade-up overflow-y-auto p-[18px] transition-opacity', detail.isPlaceholderData && 'opacity-60')}>
            {event && <p className="mb-[4px] font-mono text-[11.5px] text-muted-foreground capitalize">{event.type.replace(/_/g, ' ')}</p>}
            <SheetTitle className="text-[20px] leading-[1.3] font-semibold tracking-[-0.015em] text-pretty">{title}</SheetTitle>
            <SheetDescription asChild>
              <div className="mt-[10px] flex flex-wrap items-center gap-[6px] text-[12.5px] text-text-secondary">
                {event && (
                  <>
                    <span className="font-mono">{eventDate(event, { day: true })}</span>
                    {event.is_milestone && <CountdownChip date={event.date} />}
                    {[event.region, event.phase ? formatPhase(event.phase) : null, event.nct_id].filter(Boolean).map((t) => (
                      <span key={t} className="rounded-[5px] bg-muted px-[6px] font-mono text-[11px] text-secondary-foreground">
                        {t}
                      </span>
                    ))}
                    <SignificanceBadge value={event.significance} />
                  </>
                )}
              </div>
            </SheetDescription>
            {open && detail.isPending && (
              <div role="status" aria-label="Loading the event" className="mt-[16px] flex flex-col gap-[14px]">
                <Skeleton className="h-[32px] w-[170px] rounded-lg" />
                <Skeleton className="h-[64px] w-full" />
                <Skeleton className="h-[46px] w-full" />
                <Skeleton className="h-[110px] w-full rounded-xl" />
              </div>
            )}
            {detail.isError && (
              <div role="alert" className="mt-[16px] flex flex-wrap items-center gap-[10px] text-destructive">
                This event couldn't be loaded.
                <Button variant="outline" size="sm" className={BTN_SM} onClick={() => void detail.refetch()}>
                  <RefreshCw /> Try again
                </Button>
              </div>
            )}
            {detail.data && event && (
              <Body assetId={assetId} detail={detail.data} onClose={onClose} onOpenRecord={(r) => setRecord({ eventId: event.id, ...r })} />
            )}
          </div>
          {detail.data && (
            <div className="flex gap-[8px] border-t border-hair px-[18px] py-[12px]">
              {(['prev', 'next'] as const).map((k) => {
                const n = detail.data.neighbors[k]
                return (
                  <Button key={k} variant="outline" size="sm" disabled={!n} onClick={() => n && go(assetId, n.id)} className={cn(BTN_SM, 'min-w-0 flex-1 justify-center')}>
                    {k === 'prev' && <ChevronLeft />}
                    <span className="truncate">{n ? n.title : k === 'prev' ? 'Previous' : 'Next'}</span>
                    {k === 'next' && <ChevronRight />}
                  </Button>
                )
              })}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <RecordSheet
        assetId={assetId}
        tab={record?.tab ?? 'clinical'}
        recordKey={open && record && record.eventId === eventId ? record.key : null}
        onClose={() => setRecord(null)}
      />
    </>
  )
}

/** Open another event; when the asset's journey is on screen it scrolls there too (README §6.4 prev/next). */
function go(assetId: string, id: string) {
  const s = useEventSheet.getState()
  s.openEvent(assetId, id)
  if (s.journeyAsset === assetId) s.requestLocate(assetId, id)
}

function HeaderBranch({ assetId, branch }: { assetId: string; branch?: string }) {
  const model = branchModel(useBranches(assetId).data)
  if (!model.multi) return null
  return <BranchChip branch={model.byId.get(laneOf({ branch }, model))!} />
}

function StarButton({ assetId, eventId }: { assetId: string; eventId: string }) {
  const starred = useAnnotations(assetId).data?.stars.includes(eventId) ?? false
  const toggle = useToggleStar(assetId)
  return (
    <Button variant="ghost" size="icon-sm" aria-pressed={starred} aria-label="Mark as important" onClick={() => toggle.mutate({ eventId, on: !starred })} className={ICON_BTN}>
      <Star className={cn('size-[16px]', starred && 'fill-star text-star-stroke')} />
    </Button>
  )
}

function Body({ assetId, detail, onClose, onOpenRecord }: { assetId: string; detail: NonNullable<ReturnType<typeof useEvent>['data']>; onClose: () => void; onOpenRecord: (r: { tab: RecordTab; key: string }) => void }) {
  const navigate = useNavigate()
  const { event, records, branchStats } = detail
  const model = branchModel(useBranches(assetId).data)
  const journeyAsset = useEventSheet((s) => s.journeyAsset)
  const pool = useJourneyEvents(assetId, event.key || event.via === 'user' ? 'key' : 'all').data?.events
  const sorted = useMemo(() => chronological(pool ?? []), [pool])
  const byId = new Map((pool ?? []).map((e) => [e.id, e]))
  const missing = (event.links ?? []).some((id) => !byId.has(id))
  const all = useJourneyEvents(assetId, 'all', { enabled: missing && !!pool }).data?.events ?? []
  for (const e of all) if (!byId.has(e.id)) byId.set(e.id, e)
  const linked = (event.links ?? []).map((id) => byId.get(id)).filter((e) => !!e)
  const color = CATEGORY_META[event.category]?.color ?? CATEGORY_META.regulatory.color
  const inPlace = journeyAsset === assetId

  const locate = () => {
    if (inPlace) {
      useEventSheet.getState().requestLocate(assetId, event.id)
      onClose()
    } else {
      onClose()
      navigate(`/assets/${enc(assetId)}/overview?focus=${enc(event.id)}`)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={locate} className={cn(BTN_SM, 'mt-[12px] border-[#c7d1f4] text-primary hover:bg-primary-soft hover:text-primary')}>
        <Route className="size-[14px]" /> {inPlace ? 'Locate on timeline' : 'Show on the journey timeline'} <ArrowRight className="size-[13px]" />
      </Button>
      {event.summary && <p className="mt-[14px] leading-[1.55] text-secondary-foreground">{event.summary}</p>}
      {pool && pool.length > 1 && (
        <SheetSection title="Position in the journey">
          <PositionStrip event={event} pool={sorted} onPick={(id) => go(assetId, id)} />
        </SheetSection>
      )}
      {model.multi && (
        <SheetSection title="Branch">
          <BranchLineage event={event} model={model} stats={branchStats} />
        </SheetSection>
      )}
      {((event.indications?.length ?? 0) > 0 || event.product) && (
        <SheetSection title="Targets">
          <Targets e={event} label={false} />
        </SheetSection>
      )}
      <RecordTerms records={records} color={color} product={event.product} />
      <RegulatoryPath assetId={assetId} records={records} product={event.product} />
      {event.details && Object.keys(event.details).length > 0 && (
        <SheetSection title="Details">
          <DetailsGrid details={event.details} />
        </SheetSection>
      )}
      {event.impact && (
        <p className="mt-[12px] leading-normal text-secondary-foreground">
          <b className="font-semibold text-foreground">Why it matters · </b>
          {event.impact}
        </p>
      )}
      <Evidence event={event} records={records} onOpenRecord={onOpenRecord} />
      {linked.length > 0 && (
        <SheetSection title="Linked events">
          <ul>
            {linked.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => go(assetId, l.id)} className={cn('flex w-full items-center gap-[8px] border-b border-hair px-[2px] py-[8px] text-left text-secondary-foreground hover:text-primary', FOCUS)}>
                  <span aria-hidden="true" className="size-[8px] shrink-0 rounded-full" style={{ background: CATEGORY_META[l.category]?.color }} />
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{l.date.slice(0, 7)}</span>
                  <ArrowRight className="size-[12px]" />
                </button>
              </li>
            ))}
          </ul>
        </SheetSection>
      )}
      <Comments assetId={assetId} eventId={event.id} />
    </>
  )
}
