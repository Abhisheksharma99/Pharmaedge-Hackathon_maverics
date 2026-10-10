import { AlertTriangle, ExternalLink, Loader2, MessageSquarePlus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { EventCategory, RecordTab } from '@/features/assets/api'
import { TAB_FOR_COLLECTION } from '@/features/assets/api'
import { RecordSheet } from '@/features/assets/components/record-sheet'
import { Segmented } from '@/features/assets/components/segmented'
import { Pct } from '@/features/assets/pages/market-tab'
import { useAssetContext } from '@/features/assets/pages/asset-layout'
import { useAskStore } from '@/features/chat/ask-store'
import { formatDate } from '@/lib/format'
import { cn, safeUrl } from '@/lib/utils'
import { useShellStore } from '@/stores/shell-store'
import { useDeleteStory, useStory, type Chapter, type Story, type StoryEvent, type StoryFilters, type StoryNote } from './api'
import { useLiveStories } from './live-store'
import { CATEGORY_COLOR, CATEGORY_LABEL, StoryTimeline, eventFlag } from './story-timeline'

/**
 * A journey story Asset AI built (or is building): the question, the timeline drawn layer by layer, its filters,
 * the inspector, the model's notes ("what it means"), the chapters and what changed in the focus window. Filters
 * re-read the story from the latest data; the notes stay pinned to their events.
 */

type Range = 'all' | 'focus' | 'recent' | 'ahead' | 'chapter'
const CATEGORIES: EventCategory[] = ['regulatory', 'clinical', 'company', 'ip', 'safety']
const ROWS = 6 // per tab of "what changed" before "Show all"
const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

function Chip({ active, onClick, color, children }: { active: boolean; onClick: () => void; color?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium text-text-secondary hover:bg-accent',
        active ? 'border-[#D0D5DD] bg-card text-foreground' : 'border-[#EAECF0] bg-[#F9FAFB] text-muted-foreground',
      )}
    >
      {color && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: active ? color : '#D0D5DD' }} />}
      {children}
    </button>
  )
}

function EventLine({ e, onSelect, right }: { e: StoryEvent; onSelect: (e: StoryEvent) => void; right?: ReactNode }) {
  const flag = eventFlag(e)
  return (
    <li>
      <button type="button" onClick={() => onSelect(e)} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/60">
        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[e.category] ?? '#667085' }} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[12.5px] leading-snug">{e.title}</span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {formatDate(e.date)}
            {flag && ` · ${flag.label}`}
          </span>
        </span>
        {right}
      </button>
    </li>
  )
}

function Inspector({ e, assetName, onEvidence, onAsk, against }: { e: StoryEvent; assetName: string; onEvidence: (() => void) | null; onAsk: () => void; against: StoryEvent[] }) {
  const flag = eventFlag(e)
  return (
    <div className="space-y-3 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium">
          <span className="size-2 rounded-full" style={{ background: CATEGORY_COLOR[e.category] ?? '#667085' }} />
          {CATEGORY_LABEL[e.category] ?? e.category}
        </span>
        <span className="rounded-md bg-muted px-2 py-0.5 text-[12px] font-medium">{e.significance}</span>
        {e.upcoming && <span className="rounded-md border border-dashed px-2 py-0.5 text-[12px]">Upcoming</span>}
        {e.ownProduct === false && <span className="rounded-md bg-[#FFF6ED] px-2 py-0.5 text-[12px] font-medium text-[#B93815]">Other company's product</span>}
      </div>
      <div>
        <p className="font-mono text-[11.5px] text-muted-foreground">{formatDate(e.date)}{e.upcoming ? ' · expected' : ''}</p>
        <h3 className="text-[15px] leading-snug font-semibold">{e.title}</h3>
        {e.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">{e.summary}</p>}
      </div>
      {e.verification && e.verification.status !== 'confirmed' && (
        <div className="rounded-lg border border-[#FECDCA] bg-[#FEF3F2] p-2.5 text-[12px] text-[#912018]">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" /> {e.verification.status === 'conflict' ? 'Sources disagree' : 'Not confirmed by a regulator record'}</p>
          <p className="mt-0.5">{e.verification.note}</p>
          {against.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {against.map((a) => <li key={a.id}>vs {formatDate(a.date)} · {a.title}</li>)}
            </ul>
          )}
        </div>
      )}
      {e.verification?.status === 'confirmed' && <p className="text-[12px] text-success">Confirmed: {e.verification.note}</p>}
      {flag && flag.tone !== 'check' && e.change && (
        <p className="rounded-lg bg-[#FFFAEB] p-2 text-[12px] text-[#93370D]">
          {e.change.kind === 'added' ? `First seen ${formatDate(e.change.at)}` : `${e.change.field?.replace('_', ' ')} changed from ${String(e.change.before ?? '—')} to ${String(e.change.after ?? '—')} (detected ${formatDate(e.change.at)})`}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="text-muted-foreground">Type</dt><dd>{e.type.replace(/_/g, ' ')}</dd>
        {e.region && (<><dt className="text-muted-foreground">Region</dt><dd>{e.region}</dd></>)}
        {e.indication && (<><dt className="text-muted-foreground">Indication</dt><dd className="line-clamp-2">{e.indication}</dd></>)}
        {e.phase && (<><dt className="text-muted-foreground">Phase</dt><dd>{e.phase}</dd></>)}
        {e.sponsor && (<><dt className="text-muted-foreground">Sponsor</dt><dd>{e.sponsor}</dd></>)}
        <dt className="text-muted-foreground">Found by</dt><dd>{e.origin === 'rule' ? 'Rule · structured source' : 'AI extraction'}</dd>
        <dt className="text-muted-foreground">Sources</dt><dd>{e.sources}</dd>
        {e.impact && (<><dt className="text-muted-foreground">Share price +5d</dt><dd><Pct value={e.impact.day5 ?? e.impact.day0} /></dd></>)}
      </dl>
      <div className="flex flex-wrap gap-2">
        {onEvidence && (
          <Button size="sm" variant="outline" onClick={onEvidence}>
            <ExternalLink /> Open evidence
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onAsk}>
          <MessageSquarePlus /> Ask about this
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Asset: {assetName}</p>
    </div>
  )
}

export function StoryPanel({ storyId }: { storyId: string }) {
  const asset = useAssetContext()
  const navigate = useNavigate()
  const live = useLiveStories((s) => s.live[storyId])
  // Highlights first: High-significance events only; Key (High + Medium) and All are one click away.
  const [filters, setFilters] = useState<StoryFilters>({ significance: ['High'] })
  const [range, setRange] = useState<Range>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Several events under one cluster mark: listed in the inspector to pick from.
  const [group, setGroup] = useState<StoryEvent[] | null>(null)
  const [changeTab, setChangeTab] = useState<string | null>(null)
  const [allRows, setAllRows] = useState(false)
  const select = (id: string | null) => {
    setSelectedId(id)
    setGroup(null)
  }
  // From the lists below the timeline: select, then bring the inspector into view.
  const card = useRef<HTMLDivElement>(null)
  const show = (id: string) => {
    select(id)
    card.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const [replay, setReplay] = useState(0)
  const [record, setRecord] = useState<{ tab: RecordTab; key: string; assetId: string } | null>(null)
  const saved = useStory(live?.building ? null : storyId, filters)
  const remove = useDeleteStory()
  const ask = useAskStore((s) => s.ask)
  const openAi = useShellStore((s) => s.setAssetAiOpen)

  const building = !!live?.building
  const story = (building ? live!.story : (saved.data?.story ?? live?.story)) as (Partial<Story> & { lanes: Story['lanes'] }) | undefined
  const notes: StoryNote[] = live?.notes.length ? live.notes : (saved.data?.notes ?? [])
  const chapterNames = { ...(saved.data?.chapterNames ?? {}), ...(live?.chapterNames ?? {}) }
  const title = live?.title ?? saved.data?.title ?? 'Journey story'
  const question = live?.question ?? saved.data?.question ?? null
  const since = story?.changes?.since ?? story?.spec?.since ?? live?.spec.since ?? saved.data?.spec.since

  // A story about a focus window opens zoomed to it, so the changes have room; "All" is one click away.
  const autoFocused = useRef(false)
  const today0 = new Date().toISOString().slice(0, 10)
  useEffect(() => {
    if (autoFocused.current || !since || building) return
    autoFocused.current = true
    setRange('focus')
    setFilters((f) => ({ ...f, from: shift(since, -365), to: shift(today0, 730) }))
  }, [since, building, today0])

  // Highlights first; when that leaves too little to read (or hides what the notes point at), Key events instead.
  const autoKey = useRef(false)
  const shown = saved.data?.story.counts.shown
  useEffect(() => {
    if (autoKey.current || building || shown === undefined || saved.isPlaceholderData || filters.significance?.join() !== 'High') return
    if (since && !filters.from) return // judge the view the story opens on: after the zoom to its focus window
    autoKey.current = true
    if (shown < 12) setFilters((f) => ({ ...f, significance: undefined }))
  }, [shown, building, filters.significance, filters.from, since, saved.isPlaceholderData])

  const byId = useMemo(() => {
    const m = new Map<string, StoryEvent>()
    if (!story) return m
    const add = (e: StoryEvent) => m.set(e.id, e)
    story.lanes.forEach((l) => l.events.forEach(add))
    story.compare?.events.forEach(add)
    const c = story.changes
    if (c) [...c.developments, ...c.checks, ...c.labels, ...c.trials, ...c.upcoming].forEach(add)
    return m
  }, [story])
  const selected = selectedId ? byId.get(selectedId) : undefined

  const setSpan = (r: Range, from?: string, to?: string) => {
    setRange(r)
    setFilters(({ from: _f, to: _t, ...rest }) => ({ ...rest, ...(from ? { from } : {}), ...(to ? { to } : {}) }))
  }
  const today = story?.range?.today ?? new Date().toISOString().slice(0, 10)
  const toggleCategory = (c: EventCategory) =>
    setFilters((f) => {
      const cur = f.category?.length ? f.category : CATEGORIES
      const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
      return { ...f, category: next.length === CATEGORIES.length || !next.length ? undefined : next }
    })
  const compareOptions = [
    // the asset the story itself compares with, even when it is not a listed competitor (e.g. a sibling product)
    ...(story?.compare ? [{ id: story.compare.asset.id, name: story.compare.asset.name }] : []),
    ...asset.competitors.map((c) => ({ id: c.id, name: c.name })),
    ...(asset.competitorOf ?? []).map((c) => ({ id: c.id, name: c.name })),
  ].filter((c, i, all) => c.id !== asset.id && all.findIndex((x) => x.id === c.id) === i)
  const compareValue = filters.compare ?? story?.spec?.compare ?? 'none'

  const openEvidence = (e: StoryEvent) => {
    const tab = e.source && TAB_FOR_COLLECTION[e.source.collection]
    return tab ? () => setRecord({ tab, key: e.source!.record_key, assetId: story?.compare?.events.includes(e) ? story.compare.asset.id : asset.id }) : null
  }
  const askAbout = (e: StoryEvent) => {
    ask(`What does “${e.title}” (${formatDate(e.date)}) mean for ${asset.name}'s journey, and what changed around it?`)
    openAi(true)
  }

  if (!story && (saved.isPending || building)) return <Skeleton className="h-[520px] w-full" />
  if (saved.isError && !live) return <p className="text-destructive">This story couldn’t be loaded. It may have been deleted.</p>
  if (!story) return null

  const chapters = story.chapters ?? []
  const changes = story.changes
  const evLine = (e: StoryEvent, right?: ReactNode) => <EventLine key={e.id} e={e} onSelect={(x) => show(x.id)} right={right} />
  const changeTabs: { id: string; label: string; count: number; hint?: string; rows: ReactNode[] }[] = changes
    ? [
        { id: 'new', label: 'New', count: changes.developments.length, hint: 'Key events in the window; the figure is the share move 5 trading days later (timing, not cause).',
          rows: changes.developments.map((e) => evLine(e, e.impact ? <Pct value={e.impact.day5 ?? e.impact.day0} className="text-[11.5px]" /> : undefined)) },
        { id: 'checks', label: 'Needs checking', count: changes.checks.length, hint: 'Sources the regulator records don\'t confirm, or that disagree on a date.', rows: changes.checks.map((e) => evLine(e)) },
        { id: 'updates', label: 'Updated', count: changes.updates.length, hint: 'What the pipeline saw change between crawls.',
          rows: changes.updates.map((u) => (
            <li key={`${u.eventId}-${u.field}-${u.at}`}>
              <button type="button" className="w-full rounded-md px-1.5 py-1 text-left hover:bg-accent/60" onClick={() => show(u.eventId)}>
                <span className="line-clamp-1 text-[12.5px]">{u.title}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  {u.kind === 'changed' ? `${u.field?.replace('_', ' ')}: ${String(u.before ?? '—')} → ${String(u.after ?? '—')}` : u.kind} · {formatDate(u.at)}
                </span>
              </button>
            </li>
          )) },
        { id: 'labels', label: 'Label changes', count: changes.labels.length, rows: changes.labels.map((e) => evLine(e)) },
        { id: 'trials', label: 'Trials ended', count: changes.trials.length, rows: changes.trials.map((e) => evLine(e)) },
        { id: 'slides', label: 'Slide conflicts', count: changes.slides.length, hint: 'Investor-slide figures that contradict the slide\'s own chart.',
          rows: changes.slides.map((sl) => (
            <li key={`${sl.recordKey}-${sl.metric}`}>
              <button type="button" className="w-full rounded-md px-1.5 py-1 text-left hover:bg-accent/60" onClick={() => setRecord({ tab: 'company-ir', key: sl.recordKey, assetId: asset.id })}>
                <span className="line-clamp-1 text-[12.5px]">{sl.title}</span>
                <span className="text-[11px] text-muted-foreground">{sl.metric}: {sl.value} · {formatDate(sl.date)}</span>
              </button>
            </li>
          )) },
        { id: 'seen', label: 'First seen', count: changes.firstSeen.total, hint: `${changes.firstSeen.kept} kept by AI screening · ${changes.firstSeen.headline} headline only`,
          rows: changes.firstSeen.items.map((it) => (
            <li key={`${it.title}-${it.date}`} className="px-1.5 py-1">
              {safeUrl(it.url) ? <a href={safeUrl(it.url)!} target="_blank" rel="noreferrer" className="line-clamp-1 text-[12.5px] hover:underline">{it.title}</a> : <span className="line-clamp-1 text-[12.5px]">{it.title}</span>}
              <span className="text-[11px] text-muted-foreground">{it.source} · {formatDate(it.date)}</span>
            </li>
          )) },
        { id: 'ahead', label: 'Ahead', count: changes.upcoming.length, rows: changes.upcoming.map((e) => evLine(e)) },
      ].filter((t) => t.count > 0)
    : []

  return (
    <div className="flex flex-col gap-4">
      <div ref={card} className="scroll-mt-4 overflow-hidden rounded-[14px] border bg-card">
        {/* header */}
        <div className="flex flex-wrap items-start gap-3 border-b border-[#EEF0F3] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold">
              <Sparkles className="size-4 shrink-0 text-primary" />
              <span className="line-clamp-2">{title}</span>
              {building && <Loader2 aria-label="Building" className="size-4 animate-spin text-primary" />}
            </h2>
            {question && <p className="mt-0.5 text-[12.5px] text-text-secondary">“{question}”</p>}
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {story.counts ? `${story.counts.shown} events shown of ${story.counts.events}` : 'Building…'}
              {story.range && ` · ${formatDate(story.range.from)} – ${formatDate(story.range.to)}`}
              {saved.isFetching && !building && ' · updating…'}
            </p>
          </div>
          <Segmented
            label="Range"
            value={range === 'chapter' ? 'all' : range}
            onChange={(r) => {
              if (r === 'all') setSpan('all')
              else if (r === 'focus' && since) setSpan('focus', shift(since, -365), shift(today, 730))
              else if (r === 'recent') setSpan('recent', shift(today, -3 * 365), shift(today, 365))
              else if (r === 'ahead') setSpan('ahead', shift(today, -90), shift(today, 5 * 365))
            }}
            options={[
              { value: 'all', label: 'All' },
              ...(since ? [{ value: 'focus' as const, label: `Since ${formatDate(since)}` }] : []),
              { value: 'recent', label: 'Last 3 years' },
              { value: 'ahead', label: 'Upcoming' },
            ]}
          />
          <Button variant="outline" size="sm" onClick={() => setReplay((n) => n + 1)} disabled={building}>
            <RotateCcw /> Replay
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete story"
            disabled={building || remove.isPending}
            onClick={() => {
              if (!window.confirm(`Delete the story “${title}”?`)) return
              remove.mutate(storyId, { onSuccess: () => navigate(`/assets/${encodeURIComponent(asset.id)}/canvas`, { replace: true }) })
            }}
          >
            <Trash2 />
          </Button>
        </div>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#EEF0F3] px-4 py-2.5">
          {CATEGORIES.map((c) => (
            <Chip key={c} color={CATEGORY_COLOR[c]} active={!filters.category?.length || filters.category.includes(c)} onClick={() => toggleCategory(c)}>
              {CATEGORY_LABEL[c]}
              <span className="text-[11px] text-muted-foreground tabular-nums">{story.counts?.byCategory[c] ?? 0}</span>
            </Chip>
          ))}
          <span className="flex-1" />
          <Segmented
            label="Events shown"
            value={filters.significance?.includes('Low') ? 'all' : filters.significance?.length === 1 ? 'high' : 'key'}
            onChange={(v) => setFilters((f) => ({ ...f, significance: v === 'all' ? ['High', 'Medium', 'Low'] : v === 'high' ? ['High'] : undefined }))}
            options={[
              { value: 'high', label: 'Highlights' },
              { value: 'key', label: 'Key events' },
              { value: 'all', label: 'All events' },
            ]}
          />
          {compareOptions.length > 0 && (
            <label className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
              Compare with
              <select
                value={compareValue}
                onChange={(e) => setFilters((f) => ({ ...f, compare: e.target.value }))}
                className="h-7 rounded-lg border bg-card px-2 text-[12.5px] text-foreground"
              >
                <option value="none">No comparison</option>
                {compareOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* timeline + inspector */}
        {/* the side column only where the timeline keeps enough room; below that it sits under the timeline */}
        <div className="grid 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className={cn('min-w-0', saved.isFetching && !building && 'opacity-70')}>
            <StoryTimeline
              story={story}
              notes={notes}
              selectedId={selectedId}
              onSelect={(e) => select(e.id)}
              onSelectMany={(es) => {
                setSelectedId(null)
                setGroup(es)
              }}
              replayKey={replay}
              live={building}
            />
            <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#EEF0F3] px-4 py-2 text-[11px] text-muted-foreground">
              <span>Bigger = more significant · ◇ upcoming · numbers = grouped events</span>
              <span><b className="text-[#912018]">!</b> needs checking</span>
              {story.market && <span>{story.market.ticker}: timing, not cause</span>}
            </p>
          </div>
          <aside aria-label="Selected event" className="border-t border-[#EEF0F3] bg-[#FCFCFD] 2xl:border-t-0 2xl:border-l">
            {(selected || group) && (
              <button type="button" onClick={() => select(null)} className="mx-4 mt-3 text-[12px] font-medium text-primary hover:underline">
                ← Back to {notes.length ? 'what it means' : 'the story'}
              </button>
            )}
            {group && !selected ? (
              <div className="p-4 pt-2">
                <h3 className="mb-1.5 text-[13px] font-semibold">{group.length} events here</h3>
                <ul>{group.map((e) => <EventLine key={e.id} e={e} onSelect={(x) => setSelectedId(x.id)} />)}</ul>
              </div>
            ) : selected ? (
              <Inspector
                e={selected}
                assetName={story.compare?.events.includes(selected) ? story.compare.asset.name : asset.name}
                onEvidence={openEvidence(selected)}
                onAsk={() => askAbout(selected)}
                against={(selected.verification?.against ?? []).map((id) => byId.get(id)).filter((x): x is StoryEvent => !!x)}
              />
            ) : (
              <div className="space-y-3 p-4">
                <h3 className="text-[13px] font-semibold">What it means</h3>
                {notes.length ? (
                  <ol className="grid gap-2 md:grid-cols-2 2xl:grid-cols-1">
                    {notes.map((n, i) => (
                      <li key={n.id} className="rounded-lg border border-[#C7D7FE] border-l-[3px] border-l-primary bg-card p-2.5 text-[12.5px] leading-relaxed duration-500 animate-in fade-in slide-in-from-bottom-2 fill-mode-both" style={{ animationDelay: `${i * 0.15}s` }}>
                        <span className="mr-1.5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-[9.5px] font-bold text-white">{i + 1}</span>
                        {n.text}
                        <span className="mt-1 flex flex-wrap gap-1">
                          {n.eventIds.map((id) => byId.get(id)).filter((x): x is StoryEvent => !!x).map((e) => (
                            <button key={e.id} type="button" onClick={() => setSelectedId(e.id)} className="rounded bg-muted px-1.5 text-[11px] text-text-secondary hover:bg-accent">
                              {formatDate(e.date)}
                            </button>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">{building ? 'Asset AI is laying out the evidence…' : 'Asset AI adds its interpretation here, pinned to the events it explains. Select any mark to inspect it.'}</p>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* chapters: a compact row of pills that zoom the timeline */}
      {chapters.length > 0 && (
        <nav aria-label="Chapters" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-medium text-muted-foreground">Chapters</span>
          {chapters.map((c: Chapter) => {
            const on = range === 'chapter' && filters.from === shift(c.from, -60)
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                title={`${c.from.slice(0, 4)}–${c.to.slice(0, 4)} · ${c.events} key events`}
                onClick={() => (on ? setSpan('all') : setSpan('chapter', shift(c.from, -60), shift(c.to, 60)))}
                className={cn(
                  'inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-full border bg-card px-3 text-[12px] text-text-secondary hover:border-primary/50',
                  (on || c.focus) && 'border-primary bg-[#EEF2FD] font-medium text-primary',
                )}
              >
                <span className="font-mono text-[10.5px] text-muted-foreground">{c.from.slice(0, 4)}</span>
                <span className="truncate">{chapterNames[c.id] ?? c.name}</span>
              </button>
            )
          })}
        </nav>
      )}

      {/* what changed: one tab at a time, a few items each */}
      {changes && changeTabs.length > 0 && (() => {
        const tab = changeTabs.find((t) => t.id === changeTab) ?? changeTabs[0]!
        return (
          <section aria-label="What changed" className="overflow-hidden rounded-[14px] border bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#EEF0F3] px-4 py-3">
              <h3 className="font-semibold">{changes.since ? `What changed since ${formatDate(changes.since)}` : 'What changed recently'}</h3>
              <div role="tablist" aria-label="What changed" className="flex flex-wrap gap-1">
                {changeTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={t.id === tab.id}
                    onClick={() => {
                      setChangeTab(t.id)
                      setAllRows(false)
                    }}
                    className={cn('h-7 rounded-lg px-2.5 text-[12.5px] font-medium text-text-secondary hover:bg-accent', t.id === tab.id && 'bg-muted text-foreground')}
                  >
                    {t.label} <span className="text-[11px] text-muted-foreground tabular-nums">{t.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div role="tabpanel" className="px-3 py-2">
              {tab.hint && <p className="px-1.5 pb-1 text-[11.5px] text-muted-foreground">{tab.hint}</p>}
              <ul className="grid gap-x-6 md:grid-cols-2">{(allRows ? tab.rows : tab.rows.slice(0, ROWS)).map((r) => r)}</ul>
              {tab.rows.length > ROWS && (
                <button type="button" onClick={() => setAllRows((v) => !v)} className="mt-1 px-1.5 text-[12.5px] font-medium text-primary hover:underline">
                  {allRows ? 'Show fewer' : `Show all ${tab.rows.length}`}
                </button>
              )}
            </div>
          </section>
        )
      })()}

      {/* comparison */}
      {story.compare && (
        <section aria-label="Comparison" className="overflow-hidden rounded-[14px] border bg-card">
          <h3 className="border-b border-[#EEF0F3] px-4 py-3 font-semibold">{asset.name} vs {story.compare.asset.name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11px] text-muted-foreground">
                <tr className="border-b border-[#EEF0F3]"><th className="px-4 py-2 font-medium">Difference</th><th className="px-3 py-2 font-medium">{asset.name}</th><th className="px-3 py-2 font-medium">{story.compare.asset.name}</th></tr>
              </thead>
              <tbody>
                {story.compare.deltas.map((d) => (
                  <tr key={d.label} className="border-b border-[#EEF0F3] last:border-0 align-top">
                    <td className="px-4 py-2 font-medium">{d.label}{d.note && <span className="block text-[11px] font-normal text-primary">{d.note}</span>}</td>
                    <td className="px-3 py-2">{d.primary}</td>
                    <td className="px-3 py-2">{d.other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {record && <RecordSheet assetId={record.assetId} tab={record.tab} recordKey={record.key} onClose={() => setRecord(null)} />}
    </div>
  )
}
