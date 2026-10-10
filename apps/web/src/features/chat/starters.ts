import { useAssets } from '@/features/assets/api'

/** The four Asset AI starters (prototype `SUGGEST`); the third compares a tracked competitor with its primary when there is one. */
export function useStarterQuestions(): string[] {
  const rival = (useAssets().data ?? []).find((a) => a.kind === 'competitor' && a.competitorOf.length > 0)
  return [
    'Which assets have milestones in the next six months?',
    'What changed across my assets this month?',
    rival ? `Compare ${rival.competitorOf[0].name} with ${rival.name}` : 'Compare my assets with their closest competitors',
    'Summarize the latest Phase 3 readouts',
  ]
}
