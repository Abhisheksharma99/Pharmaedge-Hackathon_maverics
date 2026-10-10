import { Pill, RefreshCw, Sparkle } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { AssetAiPanel } from '@/features/chat/components/asset-ai-panel'
import { useRefreshAsset } from '@/features/jobs/api'
import { InlineError } from '@/components/inline-error'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { assetAiFocus, useShellStore } from '@/stores/shell-store'
import { useAsset, type AssetDetail, type RecordTab } from '../api'
import { RecordSheet } from '../components/record-sheet'
import { Chip } from '../components/badges'
import { shortIndication } from '../components/competitors/utils'

export const ASSET_TABS = [
  { path: 'overview', label: 'Overview' },
  { path: 'analytics', label: 'Analytics' },
  { path: 'evidence', label: 'Evidence' },
  { path: 'clinical', label: 'Clinical' },
  { path: 'regulatory', label: 'Regulatory' },
  { path: 'publications', label: 'Publications' },
  { path: 'conferences', label: 'Conferences' },
  { path: 'documents', label: 'Documents' },
  { path: 'company-ir', label: 'Company IR' },
  { path: 'patents', label: 'Patents' },
  { path: 'market', label: 'Market' },
  { path: 'competitors', label: 'Competitors' },
  { path: 'canvas', label: 'Canvas' },
] as const

/** Tabs get the loaded asset from the layout instead of refetching. */
export function useAssetContext(): AssetDetail {
  return useOutletContext<AssetDetail>()
}

function StatusPill({ asset }: { asset: AssetDetail }) {
  if (asset.status === 'onboarding') {
    return (
      <span className="inline-flex h-[26px] items-center gap-[6px] rounded-full bg-warning-soft px-[10px] text-[12.5px] font-semibold text-warning">
        <i aria-hidden="true" className="size-[6px] animate-blink-dot rounded-full bg-current" />
        Collecting data
      </span>
    )
  }
  if (!asset.kpis.approvalRegions.length) {
    return <span className="inline-flex h-[26px] items-center rounded-full bg-violet-soft px-[10px] text-[12.5px] font-semibold text-violet">Investigational</span>
  }
  return (
    <span className="inline-flex h-[26px] items-center gap-[6px] rounded-full bg-[#ecfdf3] px-[10px] text-[12.5px] font-semibold text-[#067647]">
      <span className="size-[6px] rounded-full bg-[#17b26a]" />
      Approved · {asset.kpis.approvalRegions.join(', ')}
    </span>
  )
}

/** Starts a refresh crawl and points to its progress. */
function RefreshButton({ assetId, building }: { assetId: string; building: boolean }) {
  const refresh = useRefreshAsset()
  const navigate = useNavigate()
  return (
    <Button
      variant="outline"
      disabled={refresh.isPending || building}
      title={building ? 'Available once onboarding finishes' : undefined}
      onClick={() =>
        refresh.mutate(assetId, {
          onSuccess: () =>
            toast.success('Data refresh started', { action: { label: 'View progress', onClick: () => navigate(`/assets/${encodeURIComponent(assetId)}/overview?build=1`) } }),
          onError: (err) =>
            err instanceof ApiError && err.code === 'JOB_ALREADY_RUNNING'
              ? toast.info('A refresh is already running', { action: { label: 'View jobs', onClick: () => navigate('/jobs') } })
              : toast.error(err instanceof ApiError ? err.message : 'Could not start the refresh'),
        })
      }
    >
      <RefreshCw className={cn('size-[15px]', refresh.isPending && 'animate-spin')} /> Refresh data
    </Button>
  )
}

function AssetHeader({
  asset,
  tabLabel,
  aiOpen,
  onToggleAi,
}: {
  asset: AssetDetail
  tabLabel: string
  aiOpen: boolean
  onToggleAi: () => void
}) {
  const facts = [asset.tags.modality, asset.tags.mechanism].filter(Boolean)
  return (
    <div className="flex flex-col gap-[14px]">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-[6px] text-text-secondary">
          <li>
            <Link to="/assets" className="hover:text-foreground">
              Asset Journey
            </Link>
          </li>
          <li aria-hidden="true" className="text-faint">/</li>
          <li>
            <Link to={`/assets/${encodeURIComponent(asset.id)}/overview`} className="hover:text-foreground">
              {asset.name}
            </Link>
          </li>
          <li aria-hidden="true" className="text-faint">/</li>
          <li aria-current="page" className="font-medium text-foreground">
            {tabLabel}
          </li>
        </ol>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-x-[24px] gap-y-[16px]">
        <div className="flex min-w-0 flex-[1_1_420px] items-start gap-[16px]">
          <span className="flex size-[60px] shrink-0 items-center justify-center rounded-[16px] bg-primary text-primary-foreground">
            <Pill className="size-[28px]" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[8px]">
              <h1 className="text-[28px] leading-[34px] font-[650] tracking-[-0.02em]">{asset.name}</h1>
              <StatusPill asset={asset} />
              {asset.kind === 'competitor' && <span className="rounded-[5px] bg-muted px-[6px] py-px text-[11px] text-secondary-foreground">Competitor</span>}
            </div>
            <p className="mt-[6px] text-[14px] text-text-secondary">
              <span className="font-medium text-foreground">{asset.company.name}</span>
              {facts.length > 0 && ` · ${facts.join(' · ')}`}
            </p>
            {asset.kind === 'competitor' && asset.competitorOf?.length > 0 && (
              <p className="mt-[4px] text-muted-foreground">
                Competitor of{' '}
                {asset.competitorOf.map((p, i) => (
                  <Fragment key={p.id}>
                    {i > 0 && ', '}
                    <Link to={`/assets/${encodeURIComponent(p.id)}/competitors`} className="font-semibold text-primary hover:underline">
                      {p.name}
                    </Link>
                  </Fragment>
                ))}
              </p>
            )}
            {asset.aliases.length > 0 && asset.kind !== 'competitor' && <p className="mt-[4px] text-muted-foreground">Also known as {asset.aliases.join(', ')}</p>}
            {!!asset.tags.indications?.length && (
              <ul aria-label="Approved indications" className="mt-[8px] flex flex-wrap gap-[6px]">
                {asset.tags.indications.map((i) => (
                  <li key={i}>
                    <Chip title={i}>{shortIndication(i)}</Chip>
                  </li>
                ))}
                {asset.tags.investigational_indications?.map((i) => (
                  <li key={i}>
                    <Chip title={i} className="border-dashed text-muted-foreground">
                      {shortIndication(i)} (investigational)
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center gap-[8px]">
          <RefreshButton assetId={asset.id} building={asset.status === 'onboarding'} />
          <Button
            variant={aiOpen ? 'outline' : 'default'}
            aria-pressed={aiOpen}
            onClick={onToggleAi}
            className={cn(aiOpen && 'border-primary bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary')}
          >
            <Sparkle className="size-[15px]" /> Ask Asset AI
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AssetLayout() {
  const { assetId = '' } = useParams()
  const tab = useLocation().pathname.split('/')[3] ?? 'overview'
  const asset = useAsset(assetId)
  const setLastAssetId = useShellStore((s) => s.setLastAssetId)
  const aiOpen = useShellStore((s) => s.assetAiOpen)
  const setAiOpen = useShellStore((s) => s.setAssetAiOpen)
  // Wide screens get a docked drawer; narrower ones an overlay sheet.
  const wide = useMediaQuery('(min-width: 1280px)')
  const onboarding = asset.data?.status === 'onboarding'
  const tabLabel = onboarding && tab === 'overview' ? 'Building journey' : (ASSET_TABS.find((t) => t.path === tab)?.label ?? '')
  const competitorCount = asset.data?.competitors?.length ?? 0
  // A record opened by Asset AI (open_record) or a shared link: ?rtab=regulatory&record=<key>
  const [params, setParams] = useSearchParams()
  const recordKey = params.get('record')
  const RECORD_TABS: RecordTab[] = ['clinical', 'regulatory', 'documents', 'company-ir', 'news', 'publications', 'conferences', 'patents']
  const recordTab = RECORD_TABS.find((t) => t === params.get('rtab')) ?? null
  const closeRecord = () =>
    setParams((p) => {
      p.delete('record')
      p.delete('rtab')
      return p
    }, { replace: true })

  useEffect(() => {
    if (asset.data) setLastAssetId(asset.data.id)
  }, [asset.data, setLastAssetId])

  // The docked drawer unmounts with its focused close button: hand focus back to "Ask Asset AI" (the sheet does it via onCloseAutoFocus).
  const wasOpen = useRef(aiOpen)
  useEffect(() => {
    if (wasOpen.current && !aiOpen && wide) assetAiFocus.target()?.focus({ preventScroll: true })
    wasOpen.current = aiOpen
  }, [aiOpen, wide])

  if (asset.isError) {
    const notFound = asset.error instanceof ApiError && asset.error.status === 404
    return (
      <Page title={notFound ? 'Asset not found' : 'Something went wrong'}>
        {!notFound && <InlineError message="The asset couldn’t be loaded." onRetry={() => void asset.refetch()} className="px-0 pt-0" />}
        <p className="text-text-secondary">
          {notFound && 'This asset doesn’t exist or was removed. '}
          <Link to="/assets" className="font-medium text-primary hover:underline">
            Back to Asset Search
          </Link>
        </p>
      </Page>
    )
  }

  const panel = asset.data && <AssetAiPanel key={asset.data.id} asset={asset.data} onClose={() => setAiOpen(false)} />

  return (
    <div className="flex min-h-full">
      <div className="mx-auto flex w-full max-w-[1400px] min-w-0 flex-col gap-[20px] px-[24px] pt-[20px] pb-[48px] max-[900px]:px-[14px] max-[900px]:pt-[16px] max-[900px]:pb-[40px]">
        {asset.data ? (
          <AssetHeader asset={asset.data} tabLabel={tabLabel} aiOpen={aiOpen} onToggleAi={() => setAiOpen(!aiOpen)} />
        ) : (
          <div className="flex gap-[16px]">
            <Skeleton className="size-[60px] rounded-[14px]" />
            <div className="space-y-[8px]">
              <Skeleton className="h-[32px] w-[256px]" />
              <Skeleton className="h-[16px] w-[384px]" />
            </div>
          </div>
        )}
        <nav aria-label="Asset sections" className="overflow-x-auto border-b">
          <ul className="flex min-w-max gap-[4px]">
            {ASSET_TABS.map((t) => (
              <li key={t.path}>
                <NavLink
                  to={`/assets/${encodeURIComponent(assetId)}/${t.path}`}
                  className={({ isActive }) =>
                    cn(
                      '-mb-px inline-flex h-[44px] items-center gap-[6px] border-b-2 border-transparent px-[12px] font-medium text-text-secondary hover:text-foreground',
                      isActive && 'border-primary text-primary hover:text-primary',
                    )
                  }
                >
                  {t.label}
                  {t.path === 'overview' && onboarding && (
                    <span aria-hidden="true" data-live-dot className="size-[6px] animate-blink-dot rounded-full bg-warning" />
                  )}
                  {t.path === 'competitors' && competitorCount > 0 && (
                    <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[10px] bg-primary-soft px-[6px] text-[12px] font-semibold text-primary">
                      {competitorCount}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {asset.data && <Outlet context={asset.data} />}
        {asset.data && recordKey && recordTab && <RecordSheet assetId={assetId} tab={recordTab} recordKey={recordKey} onClose={closeRecord} />}
      </div>
      {aiOpen && wide && (
        <aside aria-label="Asset AI" className="sticky top-0 h-[calc(100dvh-56px)] w-[440px] shrink-0 border-l bg-card">
          {panel}
        </aside>
      )}
      {!wide && asset.data && (
        <Sheet open={aiOpen} onOpenChange={setAiOpen}>
          <SheetContent showCloseButton={false} onCloseAutoFocus={assetAiFocus.onCloseAutoFocus} className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:min-[761px]:max-w-[440px]">
            <SheetTitle className="sr-only">Asset AI</SheetTitle>
            <SheetDescription className="sr-only">Ask questions about {asset.data.name}</SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
