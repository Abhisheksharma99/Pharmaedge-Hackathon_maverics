import { Loader2, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { InlineError } from '@/components/inline-error'
import { Page } from '@/components/layout/page'
import { Badge } from '@/components/ui/badge'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, type Role } from '@/features/auth/auth-context'
import { ApiError } from '@/lib/api'
import { useCreateUser, useUpdateUser, useUsers } from './users-api'

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')

function AddUserDialog() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'analyst' as Role })
  const [error, setError] = useState<string | null>(null)
  const create = useCreateUser()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await create.mutateAsync(form)
      toast.success(`${form.name} can now sign in`)
      setForm({ name: '', email: '', password: '', role: 'analyst' })
      setOpen(false)
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-[16px]">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>Share the temporary password with them directly.</DialogDescription>
          </DialogHeader>
          <div className="space-y-[6px]">
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-[6px]">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="space-y-[6px]">
            <Label htmlFor="new-password">Temporary password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <p className="text-muted-foreground">At least 12 characters.</p>
          </div>
          <div className="space-y-[6px]">
            <Label htmlFor="new-role">Role</Label>
            <Select value={form.role} onValueChange={(role) => setForm({ ...form, role: role as Role })}>
              <SelectTrigger id="new-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="analyst">Analyst</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-[12px] py-[8px] text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function UsersPage() {
  const { user: me } = useAuth()
  const users = useUsers()
  const update = useUpdateUser()

  const change = (id: string, changes: { role?: Role; active?: boolean }) =>
    update.mutate({ id, ...changes }, { onError: (err) => toast.error(message(err)) })

  return (
    <Page title="Users" description="Who can sign in, and what they can do." actions={<AddUserDialog />}>
      <div className="overflow-hidden rounded-[14px] border bg-card shadow-panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-[160px]">Role</TableHead>
              <TableHead className="w-[112px]">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isPending &&
              Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-[20px] w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {users.isError && (
              <TableRow>
                <TableCell colSpan={4} className="p-0">
                  <InlineError message={message(users.error)} onRetry={() => void users.refetch()} />
                </TableCell>
              </TableRow>
            )}
            {users.data?.map((u) => {
              const isMe = u.id === me?.id
              return (
                <TableRow key={u.id} className={u.active ? undefined : 'text-muted-foreground'}>
                  <TableCell className="font-medium">
                    {u.name} {isMe && <Badge variant="secondary">You</Badge>}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Select value={u.role} disabled={isMe} onValueChange={(role) => change(u.id, { role: role as Role })}>
                      <SelectTrigger size="sm" className="w-[128px]" aria-label={`Role for ${u.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="analyst">Analyst</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.active}
                      disabled={isMe}
                      aria-label={`${u.active ? 'Deactivate' : 'Activate'} ${u.name}`}
                      onCheckedChange={(active) => change(u.id, { active })}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </Page>
  )
}
