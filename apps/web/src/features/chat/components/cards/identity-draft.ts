import type { CreateAssetBody, Identity } from '../../api'

/** The identity as editable text; list fields are comma separated. */
export interface IdentityDraft {
  name: string
  aliases: string
  company: string
  website: string
  irUrl: string
  indications: string
  investigational: string
  mechanism: string
  modality: string
}

export function toDraft(identity: Identity): IdentityDraft {
  return {
    name: identity.name,
    aliases: identity.aliases.join(', '),
    company: identity.company.name,
    website: identity.company.website ?? '',
    irUrl: identity.company.ir_url ?? '',
    indications: identity.tags.indications.join(', '),
    investigational: (identity.tags.investigational_indications ?? []).join(', '),
    mechanism: identity.tags.mechanism ?? '',
    modality: identity.tags.modality ?? '',
  }
}

export const splitList = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

const optional = (value: string) => value.trim() || undefined

/** `POST /assets` body for the (possibly edited) identity. */
export function toCreateBody(draft: IdentityDraft, chatSessionId: string): CreateAssetBody {
  return {
    name: draft.name.trim(),
    aliases: splitList(draft.aliases),
    company: { name: draft.company.trim(), website: optional(draft.website), ir_url: optional(draft.irUrl) },
    tags: {
      indications: splitList(draft.indications),
      investigational_indications: splitList(draft.investigational),
      mechanism: optional(draft.mechanism),
      modality: optional(draft.modality),
    },
    chatSessionId,
  }
}
