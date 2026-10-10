/** "Pulmonary arterial hypertension (PAH)" → "PAH"; names without an abbreviation stay as they are. */
export function shortIndication(name: string): string {
  return name.match(/\(([^()]{1,10})\)\s*$/)?.[1] ?? name
}

/** FDA submission status codes (AP, TA) read as words, like the prototype's Approved / Under review. */
const FDA_STATUS: Record<string, string> = { AP: 'Approved', TA: 'Tentative approval' }
export const fdaStatus = (s: string) => FDA_STATUS[s] ?? s
