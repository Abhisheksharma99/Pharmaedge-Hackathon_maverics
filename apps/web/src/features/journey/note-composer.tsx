import { AlertTriangle, ArrowRight, CalendarDays, Check, CircleDashed, Flag, Loader2, Plus, Sparkle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CategoryIcon } from '@/features/assets/components/badges'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { rateLimitMessage } from '@/lib/api'
import { formatDay, todayIso } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useAddNote, useFindNote, type FindNoteResult } from './annotations-api'
import { CATEGORIES, CATEGORY_META, NOTE_TAG_LIST, NOTE_TAGS, collectionMeta } from './constants'
import type { Branch, EventCategory, JourneyEventV3, NoteTag } from './types'

/** Where a note goes: hover-to-add and "Add to timeline" fill it (README §6.5 "Where strip"); same shape as Phase 4's stand-in. */
export interface NoteDraft {
  /** YYYY-MM-DD; empty when no position was chosen ("Add to timeline"), so the date starts as today and Ask Asset AI searches without a date window. */
  date: string
  branch: string
  /** Titles of the events just before / after the position. */
  prev?: string | null
  next?: string | null
}

const STEPS = ['Reading your note', 'Searching FDA, EMA, ClinicalTrials.gov and PubMed', 'Searching news, press releases and competitor journeys']
const STEP_AT = [400, 900, 1350]

const fieldLabel = 'text-[12px] font-medium text-secondary-foreground'
const fieldControl =
  'rounded-lg border border-border bg-white px-2.5 py-2 text-[13px] leading-normal text-foreground outline-0 focus:border-primary focus:shadow-[0_0_0_3px_rgba(35,71,217,.12)]'

interface Props {
  assetId: string
  /** The note's position (hover-to-add / "Add to timeline"); null keeps the dialog closed. */
  draft: NoteDraft | null
  /** The asset's branches, trunk first; empty means a single trunk. */
  branches: Branch[]
  onClose: () => void
  /** The saved note, for the journey to scroll to it and open its detail. */
  onSaved?: (note: JourneyEventV3) => void
}

/** "Add to the journey" (README §6.5): add a note by hand, or have Asset AI find the event behind it. */
export function NoteComposer({ draft, onClose, ...rest }: Props) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-[rgba(16,24,40,.32)] backdrop-blur-none supports-backdrop-filter:backdrop-blur-none data-open:animate-[fade_.15s_both]"
        className="top-[10vh] gap-0 -translate-y-0 overflow-hidden rounded-2xl bg-white p-0 shadow-dialog ring-0 data-open:animate-[fade-up_.2s_both] sm:max-w-[560px]"
      >
        {draft && <Composer draft={draft} onClose={onClose} {...rest} />}
      </DialogContent>
    </Dialog>
  )
}

function Composer({ assetId, draft, branches, onClose, onSaved }: Props & { draft: NoteDraft }) {
  const [f, setF] = useState({
    date: draft.date || todayIso(),
    branch: draft.branch,
    tag: 'Missed by AI' as NoteTag,
    category: 'regulatory' as EventCategory,
    title: '',
    text: '',
  })
  // Only a date the user chose (hover position or typed) narrows Ask Asset AI's search.
  const [dateChosen, setDateChosen] = useState(draft.date !== '')
  const [phase, setPhase] = useState<'edit' | 'search' | 'result'>('edit')
  const [res, setRes] = useState<FindNoteResult | null>(null)
  const [step, setStep] = useState(0)
  const add = useAddNote(assetId)
  const find = useFindNote(assetId)
  const openEvent = useEventSheet((s) => s.openEvent)

  const ok = f.title.trim() !== '' || f.text.trim() !== ''
  const branch = branches.find((b) => b.id === f.branch)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  useEffect(() => {
    if (phase !== 'search') return
    const timers = STEP_AT.map((t, i) => setTimeout(() => setStep(i + 1), t))
    return () => timers.forEach(clearTimeout)
  }, [phase])

  const save = (ev: JourneyEventV3 | undefined, mode: 'manual' | 'ai') => {
    const title = ev?.title || f.title.trim() || f.text.trim().slice(0, 80)
    add
      .mutateAsync({
        date: f.date,
        branch: f.branch,
        category: f.category,
        tag: f.tag,
        title,
        text: ev?.summary ?? f.text,
        mode,
        ...(ev ? { sources: ev.sources } : {}),
      })
      .then((saved) => onSaved?.(saved))
      .catch(() => undefined)
    onClose()
  }

  const ask = () => {
    setPhase('search')
    setStep(0)
    find.mutate(
      // The API needs a title: a note with only context searches by its opening words.
      { title: f.title.trim() || f.text.trim().slice(0, 200), text: f.text, ...(dateChosen && { date: f.date }), branch: f.branch },
      {
        onSuccess: (r) => {
          setRes(r)
          setPhase('result')
          const ev = r.event
          if (r.kind === 'found' && ev) {
            setF((x) => ({ ...x, date: ev.date, branch: branches.some((b) => b.id === ev.branch) ? ev.branch! : x.branch, category: ev.category }))
          }
        },
        onError: (err) => {
          toast.error(rateLimitMessage(err) ?? "Asset AI couldn't search right now.")
          setPhase('edit')
        },
      },
    )
  }

  const ev = res?.event
  return (
    <>
      <div className="flex items-center gap-3 border-b border-hair px-4 py-3.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-violet-soft text-violet">
          <Flag className="size-3.5" aria-hidden="true" />
        </span>
        <div className="flex flex-1 flex-col">
          <DialogTitle className="text-[13px] font-bold leading-normal">Add to the journey</DialogTitle>
          <DialogDescription className="text-[12.5px] text-text-secondary">Mark something important, or tell Asset AI what it missed.</DialogDescription>
        </div>
        <Button variant="ghost" size="icon" className="text-text-secondary" onClick={onClose} aria-label="Close">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div
        data-testid="note-where"
        className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-hair bg-background px-4 py-2.5 text-[12.5px] text-text-secondary"
      >
        <CalendarDays className="size-3.5" aria-hidden="true" />
        <b className="text-[13.5px] font-semibold text-foreground">{formatDay(f.date)}</b>
        {branches.length > 1 && branch && (
          <span className="inline-flex items-center gap-[5px] font-semibold" style={{ color: branch.color }}>
            <i aria-hidden="true" className="size-[7px] rounded-full" style={{ background: branch.color }} />
            {branch.label}
          </span>
        )}
        {(draft.prev || draft.next) && (
          <span className="basis-full text-[12px] text-muted-foreground">
            {draft.prev && <>after “{draft.prev}”</>}
            {draft.prev && draft.next && ' · '}
            {draft.next && <>before “{draft.next}”</>}
          </span>
        )}
      </div>

      {phase === 'edit' && (
        <div className="flex flex-col gap-3 p-4">
          <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
            <span className={fieldLabel}>What happened?</span>
            <input
              autoFocus
              className={fieldControl}
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Yutrepia approved by FDA"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
            <span className={fieldLabel}>
              Context for Asset AI <em className="font-normal not-italic text-muted-foreground">(optional)</em>
            </span>
            <textarea
              rows={3}
              className={cn(fieldControl, 'resize-y')}
              value={f.text}
              onChange={(e) => set('text', e.target.value)}
              placeholder="Where you heard it, roughly when, who was involved…"
            />
          </label>
          <div className="flex flex-wrap gap-2.5">
            <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
              <span className={fieldLabel}>Date</span>
              <input type="date" className={fieldControl} value={f.date} onChange={(e) => {
                  set('date', e.target.value)
                  setDateChosen(true)
                }}
              />
            </label>
            {branches.length > 1 && (
              <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <span className={fieldLabel}>Branch</span>
                <select className={fieldControl} value={f.branch} onChange={(e) => set('branch', e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
              <span className={fieldLabel}>Category</span>
              <select className={fieldControl} value={f.category} onChange={(e) => set('category', e.target.value as EventCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[5px]" role="group" aria-labelledby="nc-tag-label">
            <span id="nc-tag-label" className={fieldLabel}>
              Tag
            </span>
            <div className="flex flex-wrap gap-1.5">
              {NOTE_TAG_LIST.map((t) => {
                const on = f.tag === t
                const c = NOTE_TAGS[t].color
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('tag', t)}
                    className={cn(
                      'h-7 cursor-pointer rounded-full border px-[11px] text-[12.5px] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                      on ? 'font-semibold' : 'border-border bg-white text-secondary-foreground',
                    )}
                    style={on ? { borderColor: c, color: c, background: `color-mix(in srgb, ${c} 9%, #fff)` } : undefined}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" disabled={!ok} onClick={() => save(undefined, 'manual')}>
              Add manually
            </Button>
            <span className="flex-1" />
            <Button size="sm" disabled={!ok} onClick={ask}>
              <Sparkle aria-hidden="true" />
              Ask Asset AI to find it
            </Button>
          </div>
        </div>
      )}

      {phase === 'search' && (
        <div className="flex flex-col gap-2.5 px-[18px] py-[22px]" role="status" aria-live="polite">
          {STEPS.map((t, i) => {
            const state = step > i ? 'done' : step === i ? 'run' : 'wait'
            return (
              <div
                key={t}
                className={cn('flex items-center gap-2 text-[13px] text-muted-foreground', state === 'run' && 'font-medium text-primary', state === 'done' && 'text-secondary-foreground')}
              >
                {state === 'done' ? (
                  <Check className="size-[13px] text-success" strokeWidth={2.6} aria-hidden="true" />
                ) : state === 'run' ? (
                  <Loader2 className="size-[13px] motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <CircleDashed className="size-[13px]" aria-hidden="true" />
                )}
                {t}
              </div>
            )
          })}
        </div>
      )}

      {phase === 'result' && res && (
        <div className="flex flex-col gap-3 p-4">
          <p
            className={cn(
              'm-0 flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[13px] leading-normal',
              res.kind === 'none' ? 'bg-warning-soft text-warning' : 'bg-violet-soft text-violet',
            )}
          >
            {res.kind === 'none' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <Sparkle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
            {res.note}
          </p>
          {res.kind === 'found' && ev && (
            <div className="flex flex-col gap-2 rounded-xl border border-border px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <CategoryIcon category={ev.category} className="size-[26px]" />
                <div className="flex flex-col">
                  <b className="text-[13px] font-bold">{ev.title}</b>
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {formatDay(ev.date)}
                    {branch ? ` · ${branch.label}` : ''}
                  </span>
                </div>
              </div>
              {ev.summary && <p className="m-0 text-[13px] text-text-secondary">{ev.summary}</p>}
              <div className="flex flex-wrap gap-1">
                {ev.sources.map((s) => (
                  <span key={`${s.collection}:${s.record_key}`} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-[3px] font-mono text-[11px] animate-[fade-up_.4s_both]">
                    <i aria-hidden="true" className="size-1.5 rounded-full" style={{ background: collectionMeta(s.collection).color }} />
                    {s.record_key}
                  </span>
                ))}
              </div>
            </div>
          )}
          {res.kind === 'exists' && ev && (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-transparent px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => {
                onClose()
                openEvent(assetId, ev.id)
              }}
            >
              <CategoryIcon category={ev.category} className="size-[26px]" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium">{ev.title}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{formatDay(ev.date)}</span>
              </span>
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setPhase('edit')}>
              Back
            </Button>
            <span className="flex-1" />
            {res.kind === 'found' && ev ? (
              <Button size="sm" onClick={() => save(ev, 'ai')}>
                <Plus aria-hidden="true" />
                Add to journey
              </Button>
            ) : (
              <Button size="sm" onClick={() => save(undefined, 'manual')}>
                Keep as a note
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
