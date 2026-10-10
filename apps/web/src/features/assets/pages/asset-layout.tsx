import { Pill, RefreshCw, Sparkles } from 'lucide-react'
import { Fragment, useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { AssetAiPanel } from '@/features/chat/components/asset-ai-panel'
import { useRefreshAsset } from '@/features/jobs/api'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { useShellStore } from '@/stores/shell-store'
import { useAsset, type AssetDetail, type RecordTab } from '../api'
import { RecordSheet } from '../components/record-sheet'
import { Chip } from '../components/badges'

export const ASSET_TABS = [
  { path: 'overview', label: 'Overview' },
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
    return <span className="inline-flex h-[26px] items-center rounded-full bg-warning-soft px-2.5 text-[12.5px] font-semibold text-warning">Collecting data</span>
  }
  if (!asset.kpis.approvalRegions.length) return null
  return (
    <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[#ecfdf3] px-2.5 text-[12.5px] font-semibold text-[#067647]">
      <span className="size-1.5 rounded-full bg-[#17b26a]" />
      Approved · {asset.kpis.approvalRegions.join(', ')}
    </span>
  )
}

/** Starts a refresh crawl and points to its progress. */
function RefreshButton({ assetId }: { assetId: string }) {
  const refresh = useRefreshAsset()
  const navigate = useNavigate()
  return (
    <Button
      variant="outline"
      size="lg"
      className="h-10 rounded-[10px] px-4"
      disabled={refresh.isPending}
      onClick={() =>
        refresh.mutate(assetId, {
          onSuccess: (job) =>
            toast.success('Data refresh started', { action: { label: 'View progress', onClick: () => navigate(`/jobs/${job.id}`) } }),
          onError: (err) =>
            err instanceof ApiError && err.code === 'JOB_ALREADY_RUNNING'
              ? toast.info('A refresh is already running', { action: { label: 'View jobs', onClick: () => navigate('/jobs') } })
              : toast.error(err instanceof ApiError ? err.message : 'Could not start the refresh'),
        })
      }
    >
      <RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} /> Refresh data
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
    <div className="flex flex-col gap-3.5">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-text-secondary">
          <li>
            <Link to="/assets" className="hover:text-foreground">
              Asset Journey
            </Link>
          </li>
          <li aria-hidden="true" className="text-[#98a2b3]">/</li>
          <li>
            <Link to={`/assets/${encodeURIComponent(asset.id)}/overview`} className="hover:text-foreground">
              {asset.name}
            </Link>
          </li>
          <li aria-hidden="true" className="text-[#98a2b3]">/</li>
          <li aria-current="page" className="font-medium text-foreground">
            {tabLabel}
          </li>
        </ol>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_420px] items-start gap-4">
          <span className="flex size-[60px] shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Pill className="size-7" />
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <h1 className="text-[28px] leading-[34px] font-[650] tracking-[-0.02em]">{asset.name}</h1>
              <StatusPill asset={asset} />
            </div>
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-foreground">{asset.company.name}</span>
              {facts.length > 0 && ` · ${facts.join(' · ')}`}
            </p>
            {asset.kind === 'competitor' && asset.competitorOf?.length > 0 && (
              <p className="text-text-secondary">
                Competitor of{' '}
                {asset.competitorOf.map((p, i) => (
                  <Fragment key={p.id}>
                    {i > 0 && ', '}
                    <Link to={`/assets/${encodeURIComponent(p.id)}/competitors`} className="font-medium text-primary hover:underline">
                      {p.name}
                    </Link>
                  </Fragment>
                ))}
              </p>
            )}
            {asset.aliases.length > 0 && <p className="text-muted-foreground">Also known as {asset.aliases.join(', ')}</p>}
            {!!asset.tags.indications?.length && (
              <ul aria-label="Approved indications" className="flex flex-wrap gap-1.5">
                {asset.tags.indications.map((i) => (
                  <li key={i}>
                    <Chip>{i}</Chip>
                  </li>
                ))}
                {asset.tags.investigational_indications?.map((i) => (
                  <li key={i}>
                    <Chip className="border-dashed text-muted-foreground">{i} (investigational)</Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton assetId={asset.id} />
          <Button
            size="lg"
            variant={aiOpen ? 'outline' : 'default'}
            aria-pressed={aiOpen}
            onClick={onToggleAi}
            className={cn('h-10 rounded-[10px] px-4', aiOpen && 'border-primary bg-[#eef2fd] text-primary hover:bg-[#eef2fd] hover:text-primary')}
          >
            <Sparkles /> Ask Asset AI
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
  const tabLabel = ASSET_TABS.find((t) => t.path === tab)?.label ?? ''
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

  if (asset.isError) {
    const notFound = asset.error instanceof ApiError && asset.error.status === 404
    return (
      <Page title={notFound ? 'Asset not found' : 'Something went wrong'}>
        <p className="text-text-secondary">
          {notFound ? 'This asset doesn’t exist or was removed.' : 'The asset couldn’t be loaded. Try again shortly.'}{' '}
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
      <div className="mx-auto flex w-full max-w-[1400px] min-w-0 flex-col gap-5 px-6 pt-5 pb-10">
        {asset.data ? (
          <AssetHeader asset={asset.data} tabLabel={tabLabel} aiOpen={aiOpen} onToggleAi={() => setAiOpen(!aiOpen)} />
        ) : (
          <div className="flex gap-4">
            <Skeleton className="size-[60px] rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-96" />
            </div>
          </div>
        )}
        <nav aria-label="Asset sections" className="overflow-x-auto border-b">
          <ul className="flex min-w-max gap-1">
            {ASSET_TABS.map((t) => (
              <li key={t.path}>
                <NavLink
                  to={`/assets/${encodeURIComponent(assetId)}/${t.path}`}
                  className={({ isActive }) =>
                    cn(
                      '-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-3 font-medium text-text-secondary hover:text-foreground',
                      isActive && 'border-primary text-primary hover:text-primary',
                    )
                  }
                >
                  {t.label}
                  {t.path === 'competitors' && competitorCount > 0 && (
                    <>
                      {' '}
                      <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#eef2fd] px-1.5 text-[12px] font-semibold text-primary">
                        {competitorCount}
                      </span>
                    </>
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
        <aside aria-label="Asset AI" className="sticky top-0 h-[calc(100dvh-3.5rem)] w-[440px] shrink-0 border-l bg-card">
          {panel}
        </aside>
      )}
      {!wide && asset.data && (
        <Sheet open={aiOpen} onOpenChange={setAiOpen}>
          <SheetContent showCloseButton={false} className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[440px]">
            <SheetTitle className="sr-only">Asset AI</SheetTitle>
            <SheetDescription className="sr-only">Ask questions about {asset.data.name}</SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
