import { render, screen } from '@testing-library/react'
import type { JobStep } from '@/features/jobs/api'
import type { JobFeedItem } from '../types'
import { ActivityLog } from './activity-log'

const STEPS: JobStep[] = [
  { name: 'regulatory', label: 'Regulatory (FDA, EMA)', status: 'done', counts: {}, error: null, started_at: null, finished_at: null },
  { name: 'ai_triage', label: 'AI triage of stored records', status: 'running', counts: {}, error: null, started_at: null, finished_at: null },
]
const at = (s: number) => new Date(Date.parse('2026-10-09T10:00:00Z') + s * 1000).toISOString()
const line = (id: number, extra: Partial<JobFeedItem> = {}): JobFeedItem => ({ id, t: at(id), step: 'regulatory', kind: 'info', text: `line ${id}`, ...extra })

describe('ActivityLog', () => {
  it('writes each kind of line with its clock and step tag, and a caret on the newest while running', () => {
    const items = [
      line(1, { step: 'plan', text: 'Planning onboard for Treprostinil · 17 steps' }),
      line(2, { kind: 'done', text: 'Stored 44 FDA and 12 EMA records' }),
      line(3, { step: 'news', kind: 'warn', text: 'Skipped: No newsroom crawler' }),
      line(65, { step: 'ai_triage', kind: 'ai', verdict: 'Ingest', text: '“FDA Accepts Inhaled Treprostinil sNDA for IPF”' }),
      line(66, { step: 'ai_triage', kind: 'event', text: 'FDA approves Tyvaso DPI', event_id: 'e27', merged: 3 }),
    ]
    render(<ActivityLog items={items} steps={STEPS} startedAt="2026-10-09T10:00:00Z" running />)
    const rows = [...screen.getByRole('log', { name: 'Crawl activity' }).querySelectorAll<HTMLElement>('[data-kind]')]
    expect(rows.map((r) => r.dataset.kind)).toEqual(['info', 'done', 'warn', 'ai', 'event'])
    expect(rows[0]).toHaveTextContent('00:01PlanPlanning onboard for Treprostinil · 17 steps')
    expect(rows[1]).toHaveTextContent('00:02FDA · EMAStored 44 FDA and 12 EMA records')
    expect(rows[2]).toHaveTextContent('00:03Newswires · BingSkipped: No newsroom crawler')
    expect(rows[3]).toHaveTextContent('01:05AI triageIngest“FDA Accepts Inhaled Treprostinil sNDA for IPF”')
    expect(rows[4]).toHaveTextContent('01:06AI triage+FDA approves Tyvaso DPI3')
    expect(document.querySelectorAll('[data-caret]')).toHaveLength(1)
    expect(rows[4]!.querySelector('[data-caret]')).not.toBeNull()
  })

  it('drops the caret once the job has ended and keeps only the last 140 lines', () => {
    const items = Array.from({ length: 150 }, (_, i) => line(i + 1))
    render(<ActivityLog items={items} steps={STEPS} startedAt={null} running={false} />)
    expect(document.querySelectorAll('[data-kind]')).toHaveLength(140)
    expect(screen.queryByText('line 10')).not.toBeInTheDocument()
    expect(screen.getByText('line 150')).toBeInTheDocument()
    expect(document.querySelector('[data-caret]')).toBeNull()
  })

  it('follows new lines unless the user scrolled up more than 40px', () => {
    const { rerender } = render(<ActivityLog items={[line(1)]} steps={STEPS} startedAt={null} running />)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
    rerender(<ActivityLog items={[line(1), line(2)]} steps={STEPS} startedAt={null} running />)
    expect(log.scrollTop).toBe(1000)

    log.scrollTop = 600 // 1000 − 600 − 300 = 100px from the bottom
    log.dispatchEvent(new Event('scroll'))
    rerender(<ActivityLog items={[line(1), line(2), line(3)]} steps={STEPS} startedAt={null} running />)
    expect(log.scrollTop).toBe(600)

    log.scrollTop = 680 // back within 40px of the bottom
    log.dispatchEvent(new Event('scroll'))
    rerender(<ActivityLog items={[line(1), line(2), line(3), line(4)]} steps={STEPS} startedAt={null} running />)
    expect(log.scrollTop).toBe(1000)
  })

  it('is not an announcing live region', () => {
    render(<ActivityLog items={[line(1)]} steps={STEPS} startedAt={null} running />)
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off')
  })
})
