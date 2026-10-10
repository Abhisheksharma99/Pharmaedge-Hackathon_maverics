import { TermBar } from '@/components/charts/term-bar'
import { formatPhase, formatStatus } from '@/lib/format'
import type { EventRecord } from '../api'
import { SheetSection } from './sheet-section'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Trial term (start → primary completion) and patent term (grant → expiry) from the event's own records (README §6.4). */
export function RecordTerms({ records, color, product }: { records: EventRecord[]; color: string; product?: string | null }) {
  const trial = records.find((r) => r.collection === 'trial_records')
  const patent = records.find((r) => r.collection === 'patent_records')
  const trialStart = trial ? str(trial.start_date) || str(trial.date) : ''
  const trialEnd = trial ? str(trial.primary_completion_date) || str(trial.completion_date) : ''
  return (
    <>
      {trial && (trialStart || trialEnd) && (
        <SheetSection title={`Trial · ${str(trial.acronym) || str(trial.nct_id) || trial.title}`}>
          <TermBar
            start={trialStart}
            end={trialEnd}
            color={color}
            label={[Array.isArray(trial.phases) && trial.phases.length ? formatPhase(String(trial.phases[0])) : '', trial.enrollment != null ? `n=${trial.enrollment}` : '']
              .filter(Boolean)
              .join(' · ')}
          />
          <p className="mt-[8px] text-[12.5px] leading-normal text-text-secondary">
            {[trial.title, trial.overall_status ? formatStatus(str(trial.overall_status)) : '', str(trial.lead_sponsor)].filter(Boolean).join(' · ')}
          </p>
        </SheetSection>
      )}
      {patent && (str(patent.grant_date) || str(patent.expiry_date)) && (
        <SheetSection title={`Patent term · ${str(patent.publication_number) || patent.key}`}>
          <TermBar start={str(patent.grant_date)} end={str(patent.expiry_date)} label={str(patent.legal_status) || 'Patent'} color={color} />
          <p className="mt-[8px] text-[12.5px] leading-normal text-text-secondary">
            {[patent.title, product ? `covers ${product}` : ''].filter(Boolean).join(' · ')}
          </p>
        </SheetSection>
      )}
    </>
  )
}
