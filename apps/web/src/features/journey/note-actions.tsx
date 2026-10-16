import { Pencil, Trash2, X } from 'lucide-react'
import { use, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AuthContext } from '@/features/auth/use-auth'
import { useEventSheet } from '@/stores/event-sheet-store'
import { useDeleteNote, useUpdateNote, type NotePatch } from './annotations-api'
import { useBranches } from './api'
import { ICON_BTN } from './controls'
import { NoteFields, type NoteForm } from './note-fields'
import type { JourneyEventV3 } from './types'

const formOf = (e: JourneyEventV3): NoteForm => ({
  date: e.date.slice(0, 10),
  branch: e.branch ?? '',
  tag: e.user!.tag,
  category: e.category,
  title: e.title,
  text: e.summary ?? '',
})

/** Only what changed, so an edit never rewrites fields someone else changed meanwhile. */
function patchOf(before: NoteForm, after: NoteForm): NotePatch {
  const next = { ...after, title: after.title.trim() }
  return Object.fromEntries((Object.keys(next) as (keyof NoteForm)[]).filter((k) => next[k] !== before[k]).map((k) => [k, next[k]])) as NotePatch
}

/**
 * Edit and Delete for a team note in the event sheet's header: shown to the note's author and to admins (the API's
 * rule), hidden on journey events and on other members' notes. Delete asks first and closes the sheet.
 */
export function NoteActions({ assetId, event }: { assetId: string; event: JourneyEventV3 }) {
  // Outside the signed-in app (no auth context) nobody may edit.
  const user = use(AuthContext)?.user
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const note = event.user
  // A note still being saved (temp id) has nothing on the server to change yet.
  if (event.via !== 'user' || !note || event.id.startsWith('temp:') || !user || (user.role !== 'admin' && user.id !== note.by.id)) return null
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="Edit note" title="Edit note" onClick={() => setEditing(true)} className={ICON_BTN}>
        <Pencil className="size-[15px]" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Delete note" title="Delete note" onClick={() => setConfirming(true)} className={`${ICON_BTN} hover:text-destructive`}>
        <Trash2 className="size-[15px]" />
      </Button>
      <EditNoteDialog assetId={assetId} event={event} open={editing} onClose={() => setEditing(false)} />
      <DeleteNoteDialog assetId={assetId} event={event} open={confirming} onClose={() => setConfirming(false)} />
    </>
  )
}

function EditNoteDialog({ assetId, event, open, onClose }: { assetId: string; event: JourneyEventV3; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden rounded-2xl bg-white p-0 shadow-dialog ring-0 sm:max-w-[560px]">
        {open && <EditNote assetId={assetId} event={event} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function EditNote({ assetId, event, onClose }: { assetId: string; event: JourneyEventV3; onClose: () => void }) {
  const [initial] = useState(() => formOf(event))
  const [f, setF] = useState(initial)
  const branches = useBranches(assetId).data ?? []
  const update = useUpdateNote(assetId)
  const patch = patchOf(initial, f)
  const changed = Object.keys(patch).length > 0
  const valid = f.title.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(f.date)

  const save = () => {
    // The dialog closes at once (the change shows optimistically); mutate's own callbacks would not outlive it.
    update
      .mutateAsync({ id: event.id, patch })
      .then(() => toast.success('Note updated'))
      .catch(() => undefined)
    onClose()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (changed && valid) save()
      }}
    >
      <div className="flex items-center gap-3 border-b border-hair px-4 py-3.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-violet-soft text-violet">
          <Pencil className="size-3.5" aria-hidden="true" />
        </span>
        <div className="flex flex-1 flex-col">
          <DialogTitle className="text-[13px] leading-normal font-bold">Edit note</DialogTitle>
          <DialogDescription className="text-[12.5px] text-text-secondary">Changes show on the journey for the whole team.</DialogDescription>
        </div>
        <Button type="button" variant="ghost" size="icon" className="text-text-secondary" onClick={onClose} aria-label="Close">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <NoteFields value={f} branches={branches} onChange={(k, v) => setF((x) => ({ ...x, [k]: v }))} />
        {!f.title.trim() && <p className="m-0 text-[12px] text-destructive">A note needs a title.</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!changed || !valid}>
            Save changes
          </Button>
        </div>
      </div>
    </form>
  )
}

function DeleteNoteDialog({ assetId, event, open, onClose }: { assetId: string; event: JourneyEventV3; open: boolean; onClose: () => void }) {
  const remove = useDeleteNote(assetId)
  const closeEvent = useEventSheet((s) => s.closeEvent)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this note?</DialogTitle>
          <DialogDescription>
            “{event.title}” leaves the journey for the whole team, with its stars and comments. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(event.id, {
                onSuccess: () => {
                  onClose()
                  closeEvent()
                  toast.success('Note deleted')
                },
              })
            }
          >
            <Trash2 />
            Delete note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
