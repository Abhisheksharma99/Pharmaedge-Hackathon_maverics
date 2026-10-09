import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { IdentityDraft } from './identity-draft'

const FIELDS: { key: keyof IdentityDraft; label: string; hint?: string; wide?: boolean }[] = [
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company' },
  { key: 'aliases', label: 'Aliases', hint: 'comma separated', wide: true },
  { key: 'website', label: 'Website' },
  { key: 'irUrl', label: 'IR page URL' },
  { key: 'indications', label: 'Indications', hint: 'comma separated', wide: true },
  { key: 'investigational', label: 'Investigational indications', hint: 'comma separated', wide: true },
  { key: 'mechanism', label: 'Mechanism' },
  { key: 'modality', label: 'Modality' },
]

/** Inline inputs for correcting an identity before the crawl starts. */
export function IdentityFields({ draft, onChange }: { draft: IdentityDraft; onChange: (draft: IdentityDraft) => void }) {
  const id = useId()
  return (
    <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <div key={f.key} className={f.wide ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
          <Label htmlFor={`${id}-${f.key}`} className="text-[12.5px] text-text-secondary">
            {f.label}
            {f.hint && <span className="font-normal text-muted-foreground"> ({f.hint})</span>}
          </Label>
          <Input
            id={`${id}-${f.key}`}
            value={draft[f.key]}
            onChange={(e) => onChange({ ...draft, [f.key]: e.target.value })}
            className="h-8"
          />
        </div>
      ))}
    </div>
  )
}
