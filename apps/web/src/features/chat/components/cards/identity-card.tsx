import { ArrowUpRight, BadgeCheck, Check, ChevronDown, Info, Loader2, Pill } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Chip } from '@/features/assets/components/badges'
import { ApiError } from '@/lib/api'
import { cn, safeUrl } from '@/lib/utils'
import { useCreateAsset, type Identity } from '../../api'
import { IdentityFields } from './identity-fields'
import { toCreateBody, toDraft } from './identity-draft'

const SOURCE_LABEL: Record<string, string> = { fda: 'FDA', ema: 'EMA', trials: 'Trials', pubmed: 'PubMed' }

/** "https://www.merck.com/media/news/" → "merck.com/media/news" */
function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return url
  }
}

function SiteLink({ url, verified }: { url: string; verified: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-[4px]">
      <a href={safeUrl(url)} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
        {shortUrl(url)}
      </a>
      {verified ? (
        <BadgeCheck aria-label="Verified" className="size-[14px] text-success" />
      ) : (
        <span className="text-[11.5px] text-muted-foreground">(unverified)</span>
      )}
    </span>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  )
}

/** What the resolver found for a new asset, with Confirm & start crawl / Edit (spec §5.2). */
export function IdentityCard({
  identity,
  sessionId,
  crawlStarted = false,
}: {
  identity: Identity
  sessionId: string
  /** A job card for this asset is already in the chat. */
  crawlStarted?: boolean
}) {
  const [draft, setDraft] = useState(() => toDraft(identity))
  const [editing, setEditing] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const create = useCreateAsset()

  const body = toCreateBody(draft, sessionId)
  const existing = identity.exists ? identity.existing : null
  const tracked = existing?.kind === 'primary'
  const original = identity.company
  const sources = Object.entries(identity.sources).filter(([, n]) => n > 0)
  const started = crawlStarted || create.isSuccess
  const canConfirm = !!body.name && !!body.company.name && !create.isPending

  return (
    <div className="flex flex-col gap-[12px] rounded-[12px] border bg-card px-[16px] py-[14px]">
      <div className="flex items-start justify-between gap-[12px]">
        <div className="flex min-w-0 items-start gap-[12px]">
          <span className="flex size-[32px] shrink-0 items-center justify-center rounded-[9px] bg-primary-soft text-primary">
            <Pill className="size-[17px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{body.name || identity.name}</p>
            {body.aliases.length > 0 && <p className="text-[12.5px] text-text-secondary">Also known as {body.aliases.join(', ')}</p>}
          </div>
        </div>
        {!tracked && !started && (
          <Button variant="outline" size="sm" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </div>

      {editing ? (
        <IdentityFields draft={draft} onChange={setDraft} />
      ) : (
        <dl className="grid grid-cols-[90px_1fr] gap-x-[12px] gap-y-[6px] text-[12.5px]">
          <Fact label="Company">
            <span className="inline-flex flex-wrap items-center gap-x-[6px]">
              <span className="font-medium">{body.company.name}</span>
              {body.company.website && (
                <>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <SiteLink url={body.company.website} verified={identity.website_verified && body.company.website === original.website} />
                </>
              )}
            </span>
          </Fact>
          {body.company.ir_url && (
            <Fact label="IR page">
              <SiteLink url={body.company.ir_url} verified={identity.ir_verified && body.company.ir_url === original.ir_url} />
            </Fact>
          )}
          {(body.tags.indications.length > 0 || !!body.tags.investigational_indications?.length) && (
            <Fact label="Indications">
              <span className="flex flex-wrap gap-[4px]">
                {body.tags.indications.map((i) => (
                  <Chip key={i} className="h-[24px]">{i}</Chip>
                ))}
                {body.tags.investigational_indications?.map((i) => (
                  <Chip key={i} className="h-[24px] border-dashed text-muted-foreground">{i} (investigational)</Chip>
                ))}
              </span>
            </Fact>
          )}
          {body.tags.mechanism && <Fact label="Mechanism">{body.tags.mechanism}</Fact>}
          {body.tags.modality && <Fact label="Modality">{body.tags.modality}</Fact>}
          {sources.length > 0 && (
            <Fact label="Found in">
              {sources.map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n}`).join(' · ')}
            </Fact>
          )}
        </dl>
      )}

      {!tracked && (identity.plan_summary || identity.plan.length > 0) && (
        <div className="rounded-[8px] bg-background px-[12px] py-[9px] text-[12.5px]">
          <div className="flex items-start justify-between gap-[12px]">
            <p className="text-text-secondary">
              <span className="font-semibold text-foreground">Plan: </span>
              {identity.plan_summary}
            </p>
            {identity.plan.length > 0 && (
              <button
                type="button"
                aria-expanded={showPlan}
                onClick={() => setShowPlan((s) => !s)}
                className="inline-flex shrink-0 items-center gap-[2px] font-medium text-primary hover:underline"
              >
                {showPlan ? 'Hide steps' : `${identity.plan.length} steps`}
                <ChevronDown className={cn('size-[14px] transition-transform', showPlan && 'rotate-180')} />
              </button>
            )}
          </div>
          {showPlan && (
            <ol className="mt-[8px] list-decimal space-y-[2px] pl-[20px]">
              {identity.plan.map((step) => (
                <li key={step.name}>
                  <span className="font-medium text-foreground">{step.label}</span>
                  {step.note && <span className="text-muted-foreground"> · {step.note}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {identity.notes.length > 0 && (
        <ul className="space-y-[4px] text-[12.5px] text-text-secondary">
          {identity.notes.map((note) => (
            <li key={note} className="flex items-start gap-[6px]">
              <Info className="mt-[2px] size-[14px] shrink-0 text-muted-foreground" />
              {note}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-[12px] border-t border-hair pt-[10px]">
        {tracked ? (
          <>
            <span className="inline-flex items-center gap-[6px] font-medium text-success">
              <Check className="size-[16px]" /> Already tracked
            </span>
            <Link
              to={`/assets/${encodeURIComponent(existing!.id)}/overview`}
              className="inline-flex items-center gap-[4px] text-[13px] font-semibold text-primary hover:underline"
            >
              Open asset <ArrowUpRight className="size-[14px]" />
            </Link>
          </>
        ) : started ? (
          <span className="inline-flex items-center gap-[6px] font-medium text-success">
            <Check strokeWidth={2.6} className="size-[14px]" /> Crawl started
          </span>
        ) : (
          <Button
            size="sm"
            disabled={!canConfirm}
            onClick={() => {
              setEditing(false)
              create.mutate(body)
            }}
          >
            {create.isPending && <Loader2 className="animate-spin" />}
            {existing?.kind === 'competitor' ? 'Track fully' : 'Confirm & start crawl'}
          </Button>
        )}
        {existing?.kind === 'competitor' && !started && (
          <span className="text-[12.5px] text-muted-foreground">Tracked as a competitor today, with a lighter crawl.</span>
        )}
        {create.isError && (
          <p role="alert" className="text-destructive">
            {create.error instanceof ApiError ? create.error.message : 'The crawl couldn’t be started. Try again.'}
          </p>
        )}
      </div>
    </div>
  )
}
