import { ArrowUpRight, Loader2, MapPin } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { RecordTab } from '@/features/assets/api'
import { CategoryIcon, SignificanceBadge } from '@/features/assets/components/badges'
import { RecordSheet } from '@/features/assets/components/record-sheet'
import { eventSheetFocus } from '@/stores/event-sheet-store'
import { formatDay, relativeFuture } from '@/lib/dates'
import { useEvent, type EventRecord } from './api'
import { CATEGORY_META, collectionMeta } from './constants'

const LABEL = 'mb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'

/**
 * Phase 2 event sheet: enough to answer "what is this dot?" from Home and ⌘K until Phase 4's EventDetailSheet
 * (position strip, lineage, term bars, comments, prev/next) replaces it in EventSheetHost.
 */
export function EventSheetStub({ assetId, eventId, onClose }: { assetId: string | null; eventId: string | null; onClose: () => void }) {
  const navigate = useNavigate()
  const detail = useEvent(assetId ?? '', eventId)
  const [record, setRecord] = useState<{ tab: RecordTab; key: string } | null>(null)
  const open = assetId !== null && eventId !== null
  const event = detail.data?.event

  const locate = () => {
    if (!assetId || !eventId) return
    onClose()
    navigate(`/assets/${encodeURIComponent(assetId)}/overview?focus=${encodeURIComponent(eventId)}`)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent onCloseAutoFocus={eventSheetFocus.onCloseAutoFocus} className="overflow-y-auto shadow-sheet data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
          <SheetHeader className="gap-2 pr-12">
            {event && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-secondary">
                <CategoryIcon category={event.category} />
                <span className="font-medium">{CATEGORY_META[event.category].label}</span>
                {event.branch && <span className="rounded-md border px-1.5 text-[11.5px] font-semibold text-secondary-foreground">{event.branch}</span>}
                <SignificanceBadge value={event.significance} />
              </div>
            )}
            <SheetTitle className="text-[20px] leading-snug font-semibold">{event?.title ?? 'Loading…'}</SheetTitle>
            <SheetDescription>
              {event ? (event.is_milestone ? `Expected ${formatDay(event.date)} · ${relativeFuture(event.date)}` : formatDay(event.date)) : ' '}
            </SheetDescription>
          </SheetHeader>
          {open && detail.isPending && (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {detail.isError && <p className="px-4 text-destructive">This event couldn't be loaded.</p>}
          {detail.data && event && (
            <div className="space-y-5 px-4 pb-6">
              <Button variant="outline" size="sm" onClick={locate}>
                <MapPin /> Show on the journey timeline
              </Button>
              {event.summary && <p className="leading-relaxed text-text-secondary">{event.summary}</p>}
              {event.impact && (
                <section aria-label="Why it matters">
                  <p className={LABEL}>Why it matters</p>
                  <p>{event.impact}</p>
                </section>
              )}
              <Evidence records={detail.data.records} onOpen={setRecord} />
            </div>
          )}
        </SheetContent>
      </Sheet>
      <RecordSheet assetId={assetId ?? ''} tab={record?.tab ?? 'clinical'} recordKey={record?.key ?? null} onClose={() => setRecord(null)} />
    </>
  )
}

function Evidence({ records, onOpen }: { records: EventRecord[]; onOpen: (record: { tab: RecordTab; key: string }) => void }) {
  if (!records.length) return null
  return (
    <section aria-label="Evidence">
      <p className={LABEL}>
        Evidence · {records.length} source{records.length === 1 ? '' : 's'}
      </p>
      <ul className="divide-y divide-hair rounded-xl border">
        {records.map((r) => {
          const meta = collectionMeta(r.collection)
          return (
            <li key={`${r.collection}|${r.key}`} className="flex items-center gap-3 px-3 py-2.5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="text-[12px] text-muted-foreground">
                  {meta.label}
                  {r.date && ` · ${formatDay(r.date)}`}
                </p>
              </div>
              {r.tab ? (
                <Button variant="ghost" size="sm" aria-label={`Open ${r.title}`} onClick={() => onOpen({ tab: r.tab as RecordTab, key: r.key })}>
                  Open
                </Button>
              ) : (
                r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.title}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    Open <ArrowUpRight className="size-3.5" />
                  </a>
                )
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
