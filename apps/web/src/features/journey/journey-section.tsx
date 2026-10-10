import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { AssetDetail } from '@/features/assets/api'
import { LoadError } from '@/features/assets/components/competitors/load-error'
import { EmptyState } from '@/features/assets/components/panel'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useAnnotations, useToggleStar } from './annotations-api'
import { useBranches, useEndedBranchEvents, useJourneyEvents } from './api'
import { HorizontalTrack } from './horizontal-track'
import { eventIndications, indicationOptions } from './indications'
import { JourneyHeader } from './journey-header'
import { JourneySkeleton } from './journey-skeleton'
import { branchClosures, branchModel, chronological, filterJourney, journeyCounts } from './journey-model'
import { NoteComposer, type NoteDraft } from './note-composer'
import { JourneyTree } from './tree/journey-tree'
import { useJourneyFilters } from './use-journey-filters'
import type { JourneyViewHandle } from './view-types'

const NO_STARS: string[] = []
const NO_COMMENTS = {}

/**
 * The asset journey (README §6.2–6.3), on the Overview and the Asset Journey page: header + horizontal track (default,
 * with its HUD) or tree, oldest or newest first, filters in the URL, `?focus=<eventId>` deep links and in-place
 * "Locate on timeline" from the event sheet.
 */
export function JourneySection({ asset }: { asset: Pick<AssetDetail, 'id' | 'name'> }) {
  const assetId = asset.id
  const f = useJourneyFilters()
  const events = useJourneyEvents(assetId, f.scope)
  const branches = useBranches(assetId)
  const annotations = useAnnotations(assetId)
  const toggleStar = useToggleStar(assetId)
  const openEvent = useEventSheet((s) => s.openEvent)
  const model = useMemo(() => branchModel(branches.data), [branches.data])
  const ended = useMemo(() => model.list.filter((b) => b.ended).map((b) => b.id), [model])
  const endedEvents = useEndedBranchEvents(assetId, ended)
  const all = events.data?.events
  const dated = useMemo(() => chronological(all ?? []), [all])
  const closures = useMemo(() => branchClosures(endedEvents.data?.events ?? dated, ended), [endedEvents.data, dated, ended])
  const stars = annotations.data?.stars ?? NO_STARS
  // Only the Starred filter depends on which events are starred: a star toggle must not re-lay-out the views.
  const filterStars = f.mine === 'starred' ? stars : NO_STARS
  const comments = annotations.data?.comments ?? NO_COMMENTS
  const catsKey = f.cats.join(',')
  const list = useMemo(
    () => filterJourney(dated, { cats: catsKey ? (catsKey.split(',') as typeof f.cats) : [], mine: f.mine, ind: f.ind, q: f.q }, filterStars),
    [dated, catsKey, f.mine, f.ind, f.q, filterStars],
  )
  const newestFirst = f.order === 'newest'
  /** The views' order; the header keeps the chronological list (its "2002–2025" span). */
  const ordered = useMemo(() => (newestFirst ? [...list].reverse() : list), [list, newestFirst])
  const counts = useMemo(() => journeyCounts(dated, stars), [dated, stars])
  const indications = useMemo(() => indicationOptions(dated, eventIndications), [dated])
  const [focusBranch, setFocusBranch] = useState<string | null>(null)
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const viewRef = useRef<JourneyViewHandle>(null)
  /** Whether the event a focus resolves to opens in the sheet (deep links do; "Locate on timeline" doesn't). */
  const focusOpens = useRef(true)
  const focusOn = useRef(f.focusOn)
  useEffect(() => {
    focusOn.current = f.focusOn
  })

  // The sheet can locate this asset's events in place while the journey is on screen.
  useEffect(() => {
    useEventSheet.getState().setJourneyAsset(assetId)
    return () => useEventSheet.getState().setJourneyAsset(null)
  }, [assetId])

  useEffect(
    () =>
      useEventSheet.subscribe((s, prev) => {
        if (!s.locate || s.locate === prev.locate || s.locate.assetId !== assetId) return
        if (viewRef.current?.jump(s.locate.eventId)) return
        focusOpens.current = false
        focusOn.current(s.locate.eventId)
      }),
    [assetId],
  )

  // ?focus=<eventId>: scroll + flash + open; when filtered out, show everything and retry once the data is in.
  // Primitive deps (and refs for the callbacks), so the retry fires exactly when the data arrives, not on every render.
  const focusId = f.focus
  const fScope = f.scope
  const unfiltered = !f.cats.length && !f.mine && !f.ind && !f.q
  const filterApi = useRef(f)
  useEffect(() => {
    filterApi.current = f
  })
  const ready = events.isSuccess && !events.isPlaceholderData
  useEffect(() => {
    const id = focusId
    if (!id || !ready) return
    const api = filterApi.current
    const finish = () => {
      if (focusOpens.current) openEvent(assetId, id)
      focusOpens.current = true
      api.clearFocus()
    }
    if (list.some((e) => e.id === id)) {
      if (viewRef.current?.jump(id)) finish()
      return
    }
    if (fScope === 'all' && unfiltered) finish()
    else api.showEverything()
  }, [focusId, fScope, unfiltered, ready, list, assetId, openEvent])

  // A saved note: once it is in the (possibly refiltered) list, scroll the active view to it and open its detail (README §6.5).
  const [savedId, setSavedId] = useState<string | null>(null)
  const savedShown = useRef(false)
  useEffect(() => {
    if (!savedId) return
    if (list.some((e) => e.id === savedId)) {
      if (!viewRef.current?.jump(savedId)) return
      openEvent(assetId, savedId)
      setSavedId(null)
    } else if (events.isSuccess && !savedShown.current && (f.scope !== 'all' || f.cats.length > 0 || f.mine || f.ind || f.q)) {
      savedShown.current = true
      f.showEverything()
    }
  }, [savedId, list, events.isSuccess, f, assetId, openEvent])

  const jumpTo = (id: string) => {
    if (viewRef.current?.jump(id)) openEvent(assetId, id)
    else {
      focusOpens.current = true
      f.focusOn(id)
    }
  }

  const n = list.length
  const filtered = f.cats.length > 0 || f.mine !== null || f.ind !== null || f.q !== ''
  const viewProps = {
    assetId,
    list: ordered,
    newestFirst,
    model,
    closures,
    stars,
    comments,
    focusBranch,
    onOpen: (id: string) => openEvent(assetId, id),
    onAdd: setDraft,
  }

  return (
    <section aria-label="Asset journey" className="relative flex flex-col">
      <JourneyHeader
        assetId={assetId}
        model={model}
        list={list}
        undated={(all?.length ?? 0) - dated.length}
        counts={counts}
        view={f.view}
        order={f.order}
        scope={f.scope}
        cats={f.cats}
        mine={f.mine}
        indications={indications}
        ind={f.ind}
        q={f.q}
        focusBranch={focusBranch}
        onView={f.setView}
        onOrder={f.setOrder}
        onScope={f.setScope}
        onToggleCat={f.toggleCat}
        onMine={f.setMine}
        onInd={f.setInd}
        onQuery={f.setQuery}
        onFocusBranch={setFocusBranch}
        onClear={() => {
          f.clearFilters()
          setFocusBranch(null)
        }}
        onAdd={() => setDraft({ date: '', branch: model.trunk.id })}
      />
      {(events.isPending || branches.isPending) && !events.isError && <JourneySkeleton view={f.view} />}
      {(branches.isError || annotations.isError) && !events.isError && (
        <p role="alert" className="mt-[12px] flex flex-wrap items-center gap-x-[8px] text-[12.5px] text-muted-foreground">
          {branches.isError ? 'The branches couldn’t be loaded; the journey is shown as one trunk.' : 'Stars and comments couldn’t be loaded.'}
          <Button variant="link" size="sm" className="h-auto p-0 text-[12.5px]" onClick={() => void (branches.isError ? branches.refetch() : annotations.refetch())}>
            Try again
          </Button>
        </p>
      )}
      {events.isError && (
        <div className="mt-[20px]">
          <LoadError message="The journey couldn't be loaded." onRetry={() => void events.refetch()} />
        </div>
      )}
      {events.isSuccess && n === 0 && (
        <EmptyState title={filtered ? 'No events match these filters' : 'No journey events yet'}>
          {filtered ? 'Clear the filters to see the whole journey.' : 'Events appear here as the crawl builds the journey.'}
        </EmptyState>
      )}
      {n > 0 && !branches.isPending &&
        (f.view === 'h' ? (
          <HorizontalTrack key={f.order} ref={viewRef} {...viewProps} />
        ) : (
          <JourneyTree key={f.order} ref={viewRef} {...viewProps} onStar={(id) => toggleStar.mutate({ eventId: id, on: !stars.includes(id) })} onJump={jumpTo} />
        ))}
      <NoteComposer
        assetId={assetId}
        draft={draft}
        branches={model.multi ? model.list : []}
        onClose={() => setDraft(null)}
        onSaved={(note) => {
          savedShown.current = false
          setSavedId(note.id)
        }}
      />
    </section>
  )
}
