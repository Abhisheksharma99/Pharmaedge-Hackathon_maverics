import { Loader2, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecordSheet } from '@/features/assets/components/record-sheet'
import { TAB_FOR_COLLECTION } from '@/features/assets/api'
import { useAssetContext } from '@/features/assets/pages/asset-layout'
import type { RecordTab } from '@/features/assets/api'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isActive, useJobs } from '@/features/jobs/api'
import { useShellStore } from '@/stores/shell-store'
import { useStories } from '@/features/story/api'
import { StoryPanel } from '@/features/story/story-panel'
import { useCanvas, useCanvases, useDeleteCanvas, useRefreshCanvas, useSaveCanvas, type Canvas } from './api'
import { CanvasView } from './canvas-view'
import { useLiveCanvases } from './live-store'
import { countNodes } from './tree'

const LIVE_CHECK_MS = 10_000 // while the asset's data collection runs

/**
 * One loaded canvas with its unsaved edits. Remounted (key) when another version arrives from the server, so what
 * a refresh added (`highlight`) is kept by the page. While the asset's data collection runs, the latest events are
 * merged in every few seconds (never over unsaved edits).
 */
function CanvasEditor({ canvas, highlight, onAdded }: { canvas: Canvas; highlight?: ReadonlySet<string>; onAdded: (ids: string[]) => void }) {
  const [title, setTitle] = useState(canvas.title)
  const [tree, setTree] = useState(canvas.tree)
  const [record, setRecord] = useState<{ tab: RecordTab; key: string } | null>(null)
  const save = useSaveCanvas()
  const remove = useDeleteCanvas()
  const refresh = useRefreshCanvas()
  const navigate = useNavigate()
  const dirty = tree !== canvas.tree || title.trim() !== canvas.title
  const jobs = useJobs({ asset: canvas.assetId })
  const job = jobs.data?.find((j) => isActive(j.status))
  const step = job?.steps.find((s) => s.status === 'running')

  const update = (quiet: boolean) =>
    refresh.mutate(
      { id: canvas.id, version: canvas.version },
      {
        onSuccess: ({ added, stale, changed }) => {
          const events = added.filter((id) => id.startsWith('e-')).length
          if (changed) {
            onAdded(added)
            toast.success([events && `${events} new event${events === 1 ? '' : 's'} added`, stale && `${stale} to review`].filter(Boolean).join(' · ') || 'Canvas updated')
          } else if (!quiet) toast.info('The canvas is up to date.')
        },
        onError: (err) => !quiet && toast.error(err instanceof ApiError ? err.message : 'The canvas couldn’t be updated. Try again.'),
      },
    )
  const updateRef = useRef(update)
  updateRef.current = update

  // Live while data is collected: merge new events as the pipeline writes them, and once more when it ends.
  const running = !!job
  const wasRunning = useRef(false)
  useEffect(() => {
    const ended = wasRunning.current && !running
    wasRunning.current = running
    if (dirty || (!running && !ended)) return
    if (ended) updateRef.current(true)
    if (!running) return
    const timer = setInterval(() => updateRef.current(true), LIVE_CHECK_MS)
    return () => clearInterval(timer)
  }, [running, dirty])

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const onSave = () =>
    save.mutate(
      { id: canvas.id, title: title.trim() || canvas.title, tree, version: canvas.version },
      {
        onSuccess: () => toast.success('Canvas saved'),
        onError: (err) =>
          toast.error(
            err instanceof ApiError && err.code === 'CANVAS_CONFLICT'
              ? 'This canvas was changed in another window. Reload the page to get the latest version; your edits here were not saved.'
              : err instanceof ApiError
                ? err.message
                : 'The canvas couldn’t be saved. Try again.',
          ),
      },
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Canvas title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} className="h-9 max-w-md flex-1 font-semibold" />
        <span className="text-[12.5px] text-muted-foreground">
          {countNodes(tree)} nodes · saved {formatDate(canvas.updatedAt)}
          {dirty && ' · unsaved changes'}
        </span>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          disabled={dirty || refresh.isPending}
          title={dirty ? 'Save your edits first' : 'Add the latest journey events; your edits are kept'}
          onClick={() => update(false)}
        >
          {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Update from latest data
        </Button>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={onSave}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={remove.isPending}
          onClick={() => {
            if (!window.confirm(`Delete the canvas “${canvas.title}”? This can’t be undone.`)) return
            remove.mutate(canvas.id, { onSuccess: () => navigate(`/assets/${encodeURIComponent(canvas.assetId)}/canvas`, { replace: true }) })
          }}
        >
          <Trash2 /> Delete
        </Button>
      </div>
      {job && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-[#d1e9ff] bg-[#f5faff] px-3 py-2 text-[12.5px] text-text-secondary">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          {dirty
            ? 'Data collection is running. Live updates are paused while you have unsaved edits.'
            : `Data collection is running${step ? ` (${step.label})` : ''}. New journey events are added to this canvas as they arrive.`}
        </p>
      )}
      <CanvasView
        tree={tree}
        highlight={highlight}
        onChange={setTree}
        onOpenSource={(s) => {
          const tab = TAB_FOR_COLLECTION[s.collection]
          if (tab) setRecord({ tab, key: s.record_key })
          else toast.info('This source has no record view.')
        }}
      />
      {record && <RecordSheet assetId={canvas.assetId} tab={record.tab} recordKey={record.key} onClose={() => setRecord(null)} />}
    </div>
  )
}

/** Asset tab: the journey stories and canvases Asset AI built for this user; one open. */
export function CanvasTab() {
  const asset = useAssetContext()
  const { canvasId, storyId: routeStoryId } = useParams()
  const list = useCanvases(asset.id)
  const stories = useStories(asset.id)
  // Nothing named in the address: the most recent of the user's stories and canvases.
  const latestStory = stories.data?.[0]
  const latestCanvas = list.data?.[0]
  const storyFirst = !canvasId && !routeStoryId && !!latestStory && (!latestCanvas || latestStory.updatedAt > latestCanvas.updatedAt)
  const storyId = routeStoryId ?? (storyFirst ? latestStory!.id : null)
  const openId = storyId ? null : (canvasId ?? latestCanvas?.id ?? null)
  const canvas = useCanvas(openId)
  const openAi = useShellStore((s) => s.setAssetAiOpen)
  const live = useLiveCanvases((s) => (openId ? s.live[openId] : undefined))
  const [added, setAdded] = useState<{ id: string; ids: Set<string> } | null>(null)

  // New nodes stay marked for a while after an update.
  useEffect(() => {
    if (!added) return
    const timer = setTimeout(() => setAdded(null), 15_000)
    return () => clearTimeout(timer)
  }, [added])

  if (live) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="flex items-center gap-2 font-semibold">
          <Loader2 className="size-4 animate-spin text-primary" /> Building “{live.title}” · {countNodes(live.tree)} nodes so far
        </p>
        <CanvasView tree={live.tree} readOnly onChange={() => {}} onOpenSource={() => {}} />
      </div>
    )
  }

  const nav = ((list.data?.length ?? 0) + (stories.data?.length ?? 0) > 1 || (storyId && (list.data?.length ?? 0) > 0)) && (
    <nav aria-label="Stories and canvases" className="flex flex-wrap gap-1.5">
      {(stories.data ?? []).map((s) => (
        <NavLink
          key={s.id}
          to={`/assets/${encodeURIComponent(asset.id)}/canvas/story/${encodeURIComponent(s.id)}`}
          className={cn(
            'inline-flex h-8 max-w-[300px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium text-text-secondary hover:text-foreground',
            s.id === storyId && 'border-primary bg-[#eef2fd] text-primary hover:text-primary',
          )}
        >
          <span className="rounded bg-primary/10 px-1 text-[10.5px] font-semibold text-primary">Story</span>
          <span className="truncate">{s.title}</span>
        </NavLink>
      ))}
      {(list.data ?? []).map((c) => (
        <NavLink
          key={c.id}
          to={`/assets/${encodeURIComponent(asset.id)}/canvas/${encodeURIComponent(c.id)}`}
          className={cn(
            'inline-flex h-8 max-w-[260px] items-center rounded-lg border px-2.5 text-[12.5px] font-medium text-text-secondary hover:text-foreground',
            c.id === openId && 'border-primary bg-[#eef2fd] text-primary hover:text-primary',
          )}
        >
          <span className="truncate">{c.title}</span>
        </NavLink>
      ))}
    </nav>
  )

  if (storyId) {
    return (
      <div className="flex flex-col gap-4">
        {nav}
        <StoryPanel key={storyId} storyId={storyId} />
      </div>
    )
  }

  if (list.isPending || stories.isPending || (openId && canvas.isPending)) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (!openId) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[14px] border bg-card px-6 py-14 text-center">
        <p className="text-base font-semibold">No story or canvas yet</p>
        <p className="max-w-md text-text-secondary">
          Ask Asset AI a question about the journey, for example “What changed for {asset.name} in the last year, and what does it mean?”. It builds the story here, layer by layer. Ask for a tree to get an editable canvas.
        </p>
        <Button onClick={() => openAi(true)}>
          <Sparkles /> Open Asset AI
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {nav}
      {canvas.isError && <p className="text-destructive">This canvas couldn’t be loaded. It may have been deleted.</p>}
      {canvas.data?.status === 'building' && (
        <p role="status" className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Asset AI is building this canvas…
        </p>
      )}
      {canvas.data && canvas.data.status !== 'building' && (
        <CanvasEditor
          key={`${canvas.data.id}:${canvas.data.version}`}
          canvas={canvas.data}
          highlight={added?.id === canvas.data.id ? added.ids : undefined}
          onAdded={(ids) => setAdded({ id: canvas.data!.id, ids: new Set(ids) })}
        />
      )}
    </div>
  )
}
