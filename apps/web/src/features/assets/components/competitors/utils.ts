import type { RecordTab } from '../../api'
import type { CompetitorMilestone, EventSource } from '../../competitors-api'
import { TAB_FOR_COLLECTION } from '../journey-timeline'

/** "Pulmonary arterial hypertension (PAH)" → "PAH"; names without an abbreviation stay as they are. */
export function shortIndication(name: string): string {
  return name.match(/\(([^()]{1,10})\)\s*$/)?.[1] ?? name
}

/** "trial_readout" → "Trial readout" */
export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Where an event's first source record opens: the record lives under the event's own asset. */
export function sourceTarget(assetId: string, sources: EventSource[]): { assetId: string; tab: RecordTab; key: string } | null {
  const source = sources[0]
  const tab = source && TAB_FOR_COLLECTION[source.collection]
  return source && tab ? { assetId, tab, key: source.record_key } : null
}

export type MilestoneGroup = 'readout' | 'regulatory' | 'patent' | 'other'

export const MILESTONE_GROUPS: Record<MilestoneGroup, { label: string; chip: string; event: string; mark: string }> = {
  readout: { label: 'Trial readouts', chip: 'Trial readout', event: 'bg-[#fef6ee] text-warning', mark: 'rounded-full bg-warning' },
  regulatory: { label: 'Regulatory decisions', chip: 'Regulatory decision', event: 'bg-muted text-secondary-foreground', mark: 'rounded-[2px] bg-secondary-foreground' },
  patent: { label: 'Patent expiries', chip: 'Patent expiry', event: 'bg-violet-soft text-violet', mark: 'rotate-45 bg-violet' },
  other: { label: 'Other', chip: 'Other', event: 'bg-muted text-text-secondary', mark: 'rounded-full bg-[#98a2b3]' },
}

export function milestoneGroup(m: Pick<CompetitorMilestone, 'type' | 'category'>): MilestoneGroup {
  if (m.type === 'patent_expiry') return 'patent'
  if (m.type === 'expected_readout' || m.type === 'trial_readout') return 'readout'
  if (m.type === 'regulatory_decision_expected' || m.type === 'approval' || m.category === 'regulatory') return 'regulatory'
  return 'other'
}
