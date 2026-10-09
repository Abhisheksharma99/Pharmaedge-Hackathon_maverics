import { cn } from '@/lib/utils'

/** Two-letter asset tile of the v3 shell ("Treprostinil" → "Tr"): primary on --primary-soft, competitors muted. */
export function AssetTile({
  name,
  kind,
  size = 28,
  className,
}: {
  name: string
  kind: 'primary' | 'competitor'
  size?: number
  className?: string
}) {
  const letters = name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[28%] font-[650] tracking-[-0.02em]',
        kind === 'competitor' ? 'bg-muted text-text-secondary' : 'bg-primary-soft text-primary',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase()}
    </span>
  )
}
