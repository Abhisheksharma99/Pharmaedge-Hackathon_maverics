import { BookmarkPlus, Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAssets } from '@/features/assets/api'
import { useAddNote } from '@/features/journey/annotations-api'
import { useBranches } from '@/features/journey/api'
import { CATEGORIES, CATEGORY_META, noteColor } from '@/features/journey/constants'
import type { EventCategory } from '@/features/journey/types'
import { todayIso } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '../api'
import { answerAssets, noteFromAnswer } from '../transcript'

const LABEL = 'text-[12px] font-medium text-secondary-foreground'
const CONTROL =
  'w-full min-w-0 rounded-[8px] border bg-background px-[10px] py-[7px] text-[13px] text-foreground outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/12'

/**
 * "Save to journey": the answer as a team note ("Important") on the journey of the asset it is about, through the
 * notes API (which decides who may add one). Asks which asset when the answer covers several, or none.
 */
export function SaveNoteDialog({ question, message, onClose }: { question: string | null; message: ChatMessage; onClose: () => void }) {
  const navigate = useNavigate()
  const assets = useAssets()
  const cited = answerAssets(message)
  const [assetId, setAssetId] = useState(cited.length === 1 ? cited[0]!.id : '')
  const choices = cited.length > 1 ? cited : (assets.data ?? []).map((a) => ({ id: a.id, name: a.name }))
  const nameOf = (id: string) => assets.data?.find((a) => a.id === id)?.name ?? cited.find((a) => a.id === id)?.name ?? id
  const [form, setForm] = useState(() => {
    const draft = noteFromAnswer(question, message, assetId, window.location.origin)
    return { title: draft.title, text: draft.text, category: draft.category as EventCategory, date: todayIso(), branch: '' }
  })
  const branches = useBranches(assetId, { enabled: assetId !== '' })
  const add = useAddNote(assetId)
  const ids = { asset: useId(), title: useId(), text: useId(), date: useId(), category: useId(), branch: useId() }
  const branchList = branches.data ?? []
  const trunk = branchList.find((b) => b.trunk) ?? branchList[0]
  const sources = assetId ? noteFromAnswer(question, message, assetId, window.location.origin).sources : []

  const pickAsset = (id: string) => {
    setAssetId(id)
    // The category follows what the newly chosen asset's cited records mostly are; the typed title and text stay.
    setForm((f) => ({ ...f, branch: '', category: noteFromAnswer(question, message, id, window.location.origin).category }))
  }

  const save = async () => {
    try {
      const saved = await add.mutateAsync({
        date: form.date || todayIso(),
        branch: form.branch || trunk?.id || '',
        category: form.category,
        tag: 'Important',
        title: form.title.trim(),
        text: form.text.trim(),
        mode: 'manual',
        sources,
      })
      onClose()
      const to = `/journey/${encodeURIComponent(assetId)}?focus=${encodeURIComponent(saved.id)}`
      toast.success('Saved to the journey', { description: `${nameOf(assetId)} · ${saved.title}`, action: { label: 'View', onClick: () => navigate(to) } })
    } catch {
      // useAddNote has said so (toast) and taken the optimistic note out again; the dialog stays open to retry.
    }
  }

  const ready = assetId !== '' && form.title.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(form.date)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-32px)] gap-[14px] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-[8px]">
            <BookmarkPlus className="size-[16px] text-primary" aria-hidden="true" /> Save to journey
          </DialogTitle>
          <DialogDescription>Adds this answer to the asset’s journey as a team note everyone can see.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-[12px]">
          {cited.length === 1 ? (
            <p className="text-[12.5px] text-secondary-foreground">
              Asset <b className="font-semibold text-foreground">{nameOf(assetId)}</b>
            </p>
          ) : (
            <div className="flex flex-col gap-[5px]">
              <label htmlFor={ids.asset} className={LABEL}>
                {cited.length > 1 ? 'This answer covers several assets: which journey?' : 'Which asset’s journey?'}
              </label>
              <select id={ids.asset} className={CONTROL} value={assetId} onChange={(e) => pickAsset(e.target.value)}>
                <option value="" disabled>
                  Choose an asset
                </option>
                {choices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {nameOf(a.id)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-[5px]">
            <label htmlFor={ids.title} className={LABEL}>
              Title
            </label>
            <input id={ids.title} className={CONTROL} maxLength={200} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-[5px]">
            <label htmlFor={ids.text} className={LABEL}>
              Note
            </label>
            <textarea
              id={ids.text}
              rows={7}
              maxLength={4000}
              className={cn(CONTROL, 'resize-y leading-[19px]')}
              value={form.text}
              onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap gap-[10px]">
            <div className="flex min-w-[140px] flex-1 flex-col gap-[5px]">
              <label htmlFor={ids.date} className={LABEL}>
                Date
              </label>
              <input id={ids.date} type="date" className={CONTROL} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="flex min-w-[140px] flex-1 flex-col gap-[5px]">
              <label htmlFor={ids.category} className={LABEL}>
                Category
              </label>
              <select id={ids.category} className={CONTROL} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as EventCategory }))}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </div>
            {branchList.length > 1 && (
              <div className="flex min-w-[140px] flex-1 flex-col gap-[5px]">
                <label htmlFor={ids.branch} className={LABEL}>
                  Branch
                </label>
                <select id={ids.branch} className={CONTROL} value={form.branch || trunk?.id} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}>
                  {branchList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label || b.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-[8px] text-[12px] text-muted-foreground">
            <span
              className="inline-flex h-[20px] items-center gap-[5px] rounded-full border px-[8px] font-semibold"
              style={{ color: noteColor('Important'), borderColor: 'currentColor' }}
            >
              Important
            </span>
            {!assetId
              ? 'Choose an asset to attach its cited records'
              : sources.length > 0
                ? `${sources.length} cited source record${sources.length === 1 ? '' : 's'} attached`
                : 'No cited records for this asset'}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || add.isPending} onClick={() => void save()}>
            {add.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
