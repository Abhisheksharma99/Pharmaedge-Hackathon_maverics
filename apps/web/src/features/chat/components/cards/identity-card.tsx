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
    <span className="inline-flex flex-wrap items-center gap-1">
      <a href={safeUrl(url)} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
        {shortUrl(url)}
      </a>
      {verified ? (
        <BadgeCheck aria-label="Verified" className="size-3.5 text-success" />
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
    <div className="flex flex-col gap-3.5 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#eef2fd] text-primary">
            <Pill className="size-[18px]" />
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
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <Fact label="Company">
            <span className="inline-flex flex-wrap items-center gap-x-1.5">
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
              <span className="flex flex-wrap gap-1">
                {body.tags.indications.map((i) => (
                  <Chip key={i} className="h-6">{i}</Chip>
                ))}
                {body.tags.investigational_indications?.map((i) => (
                  <Chip key={i} className="h-6 border-dashed text-muted-foreground">{i} (investigational)</Chip>
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
        <div className="rounded-lg bg-[#f9fafb] px-3 py-2.5 text-[12.5px]">
          <div className="flex items-start justify-between gap-3">
            <p className="text-text-secondary">
              <span className="font-semibold text-foreground">Plan: </span>
              {identity.plan_summary}
            </p>
            {identity.plan.length > 0 && (
              <button
                type="button"
                aria-expanded={showPlan}
                onClick={() => setShowPlan((s) => !s)}
                className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary hover:underline"
              >
                {showPlan ? 'Hide steps' : `${identity.plan.length} steps`}
                <ChevronDown className={cn('size-3.5 transition-transform', showPlan && 'rotate-180')} />
              </button>
            )}
          </div>
          {showPlan && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-5">
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
        <ul className="space-y-1 text-[12.5px] text-text-secondary">
          {identity.notes.map((note) => (
            <li key={note} className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              {note}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-[#eef0f3] pt-3">
        {tracked ? (
          <>
            <span className="inline-flex items-center gap-1.5 font-medium text-success">
              <Check className="size-4" /> Already tracked
            </span>
            <Link
              to={`/assets/${encodeURIComponent(existing!.id)}/overview`}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
            >
              Open asset <ArrowUpRight className="size-3.5" />
            </Link>
          </>
        ) : started ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-success">
            <Check className="size-4" /> Crawl started
          </span>
        ) : (
          <Button
            className="h-9 rounded-[10px] px-3.5"
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
