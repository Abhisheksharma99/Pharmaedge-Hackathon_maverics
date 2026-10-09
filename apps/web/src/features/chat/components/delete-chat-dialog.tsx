import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useDeleteChatSession, type ChatSession } from '../api'
import { useTurnStore } from '../turn-store'

/** Trash button with a confirm step; `onDeleted` runs after the session is gone. */
export function DeleteChatDialog({ session, onDeleted }: { session: ChatSession; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const remove = useDeleteChatSession()
  const title = session.title || 'New chat'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete chat “${title}”`}
          className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this chat?</DialogTitle>
          <DialogDescription>“{title}” and its answers will be removed. This can’t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(session.id, {
                onSuccess: () => {
                  const turns = useTurnStore.getState()
                  turns.turns[session.id]?.controller.abort()
                  turns.clear(session.id)
                  setOpen(false)
                  onDeleted()
                },
                onError: () => toast.error('The chat couldn’t be deleted. Try again.'),
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
