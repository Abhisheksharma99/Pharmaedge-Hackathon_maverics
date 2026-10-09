import { Radar } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import type { AssetDetail } from '../../api'
import { useIdentifyCompetitors } from '../../competitors-api'
import { Panel } from '../panel'

/** Shown before the competitor scan has found anything: explains how competitors are picked and starts the scan. */
export function IdentifyCompetitors({ asset }: { asset: AssetDetail }) {
  const identify = useIdentifyCompetitors()
  const navigate = useNavigate()
  const indications = [...(asset.tags.indications ?? []), ...(asset.tags.investigational_indications ?? [])]
  const mechanism = asset.tags.mechanism

  const start = () =>
    identify.mutate(asset.id, {
      onSuccess: (job) =>
        toast.success('Identifying competitors', {
          description: 'Each competitor found is then crawled; this takes a few minutes.',
          action: { label: 'View progress', onClick: () => navigate(`/jobs/${job.id}`) },
        }),
      onError: (err) =>
        err instanceof ApiError && err.code === 'JOB_ALREADY_RUNNING'
          ? toast.info('A data refresh is already running for this asset', {
              action: { label: 'View jobs', onClick: () => navigate('/jobs') },
            })
          : toast.error(err instanceof ApiError ? err.message : 'Could not start the competitor scan'),
    })

  return (
    <Panel title="Competitive landscape">
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[#eef2fd] text-primary">
          <Radar className="size-5" />
        </span>
        <p className="font-medium">No competitors identified yet</p>
        <p className="mt-1 max-w-lg text-text-secondary">
          Competitors are identified by shared indication and mechanism
          {indications.length > 0 && <>: assets approved or in development for {indications.join(', ')}</>}
          {mechanism && <>, or sharing its mechanism ({mechanism})</>}. Each one found gets its own
          regulatory, clinical and publication record.
        </p>
        <Button size="lg" className="mt-4 h-10 rounded-[10px] px-4" disabled={identify.isPending || identify.isSuccess} onClick={start}>
          <Radar /> {identify.isSuccess ? 'Identification started' : 'Identify competitors'}
        </Button>
      </div>
    </Panel>
  )
}
