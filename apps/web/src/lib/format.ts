const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2021-03-31" → "31 Mar 2021"; "2021-03" → "Mar 2021"; empty → "Undated". Never shifts by timezone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Undated'
  const [y, m, d] = iso.slice(0, 10).split('-')
  const month = m ? MONTHS[Number(m) - 1] : undefined
  if (!y || !month) return iso
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`
}

/** "2021-03-31" → "Mar 2021" */
export function formatMonth(iso: string | null | undefined): string {
  return iso ? formatDate(iso.slice(0, 7)) : 'Undated'
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

/** "PHASE3" → "Phase 3", "EARLY_PHASE1" → "Early phase 1" */
export function formatPhase(phase: string | null | undefined): string {
  if (!phase || phase === 'NA') return 'N/A'
  return phase.replace('EARLY_PHASE', 'Early phase ').replace('PHASE', 'Phase ')
}

/** "ACTIVE_NOT_RECRUITING" → "Active, not recruiting" */
export function formatStatus(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  const s = status.toLowerCase().replace(/_/g, ' ')
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace('active not', 'active, not')
}
