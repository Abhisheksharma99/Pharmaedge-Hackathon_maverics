import { cn } from '@/lib/utils'

// Soft tint + strong ink pairs from the redesign.
const TONES = [
  'bg-[#fdeee4] text-[#b4480a]',
  'bg-[#fce8f1] text-[#a32a64]',
  'bg-[#e3f5f2] text-[#0a6e64]',
  'bg-[#f0ebfd] text-[#6230c2]',
  'bg-[#fbf1dc] text-[#854d0e]',
]

/** Same asset, same colour, in every section. */
function toneFor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]
}

/** Two-letter initials tile: "Tezepelumab" → "Te". The reference asset gets the brand colour. */
export function AssetAvatar({
  id,
  name,
  isReference = false,
  size = 'md',
}: {
  id: string
  name: string
  isReference?: boolean
  size?: 'sm' | 'md'
}) {
  const letters = name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center font-bold',
        size === 'md' ? 'size-8 rounded-[9px] text-[12px]' : 'size-[26px] rounded-[7px] text-[11.5px]',
        isReference ? 'bg-primary text-primary-foreground' : toneFor(id),
      )}
    >
      {letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase()}
    </span>
  )
}
