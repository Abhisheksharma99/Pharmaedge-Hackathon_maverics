import { useId } from 'react'
import { cn } from '@/lib/utils'
import { CATEGORIES, CATEGORY_META, NOTE_TAG_LIST, NOTE_TAGS } from './constants'
import type { Branch, EventCategory, NoteTag } from './types'

const fieldLabel = 'text-[12px] font-medium text-secondary-foreground'
const fieldControl =
  'rounded-lg border border-border bg-white px-2.5 py-2 text-[13px] leading-normal text-foreground outline-0 focus:border-primary focus:shadow-[0_0_0_3px_rgba(35,71,217,.12)]'

/** A team note's editable fields. */
export interface NoteForm {
  date: string
  branch: string
  tag: NoteTag
  category: EventCategory
  title: string
  text: string
}

/** The fields of a team note (title, context, date, branch, category, tag): adding one and editing one share them. */
export function NoteFields({
  value,
  branches,
  onChange,
}: {
  value: NoteForm
  /** The asset's branches, trunk first; one or none hides the Branch field. */
  branches: Branch[]
  onChange: <K extends keyof NoteForm>(key: K, value: NoteForm[K]) => void
}) {
  const tagLabel = useId()
  return (
    <>
      <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <span className={fieldLabel}>What happened?</span>
        <input
          autoFocus
          className={fieldControl}
          value={value.title}
          onChange={(e) => onChange('title', e.target.value)}
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
          value={value.text}
          onChange={(e) => onChange('text', e.target.value)}
          placeholder="Where you heard it, roughly when, who was involved…"
        />
      </label>
      <div className="flex flex-wrap gap-2.5">
        <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <span className={fieldLabel}>Date</span>
          <input type="date" className={fieldControl} value={value.date} onChange={(e) => onChange('date', e.target.value)} />
        </label>
        {branches.length > 1 && (
          <label className="flex min-w-0 flex-1 flex-col gap-[5px]">
            <span className={fieldLabel}>Branch</span>
            <select className={fieldControl} value={value.branch} onChange={(e) => onChange('branch', e.target.value)}>
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
          <select className={fieldControl} value={value.category} onChange={(e) => onChange('category', e.target.value as EventCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]" role="group" aria-labelledby={tagLabel}>
        <span id={tagLabel} className={fieldLabel}>
          Tag
        </span>
        <div className="flex flex-wrap gap-1.5">
          {NOTE_TAG_LIST.map((t) => {
            const on = value.tag === t
            const c = NOTE_TAGS[t].color
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => onChange('tag', t)}
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
    </>
  )
}
