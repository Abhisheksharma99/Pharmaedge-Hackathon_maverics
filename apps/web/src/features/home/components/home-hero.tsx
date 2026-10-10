import { Send, Sparkle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { HomeCounts } from '../home-data'

const greeting = (hour: number) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Home hero (README §5.2): date, greeting, summary sentence and the Ask Asset AI input. */
export function HomeHero({
  firstName,
  counts,
  building,
  loading = false,
}: {
  firstName: string
  counts: HomeCounts | null
  building: { name: string; pct: number } | null
  /** The portfolio events behind `counts` are still loading: hold the sentence's space. */
  loading?: boolean
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  // Read once per mount (react purity: no Date calls during render).
  const [now] = useState(() => new Date())
  const ask = q.trim()

  return (
    <section className="flex flex-wrap items-end justify-between gap-x-[32px] gap-y-[16px] pt-[4px] pb-[2px]">
      <div className="min-w-0 flex-[1_1_420px]">
        <p className="text-[12.5px] text-muted-foreground">
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <h1 className="mt-[4px] text-[30px] leading-[36px] font-[650] tracking-[-0.025em]">
          {greeting(now.getHours())}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        {!counts && loading && <Skeleton className="mt-[8px] h-[18px] w-[380px] max-w-full" />}
        {counts && (
          <p className="mt-[6px] text-[14px] text-pretty text-text-secondary">
            <b className="font-semibold text-foreground">{plural(counts.new30, 'new event')}</b> in the last 30 days
            {counts.high30 > 0 && ` (${counts.high30} high-significance)`} · <b className="font-semibold text-foreground">{plural(counts.next6m, 'milestone')}</b> in the
            next 6 months
            {building && (
              <>
                {' '}
                · {building.name} journey <b className="font-semibold text-foreground">{building.pct}% built</b>
              </>
            )}
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          navigate(ask ? `/chat?ask=${encodeURIComponent(ask)}` : '/chat')
        }}
        className="flex h-[46px] min-w-[280px] flex-[0_1_460px] items-center gap-[8px] rounded-[12px] border bg-card pr-[6px] pl-[14px] shadow-panel transition-[border-color,box-shadow] focus-within:border-primary focus-within:shadow-focus"
      >
        <Sparkle className="size-[16px] shrink-0 text-violet" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about your assets, competitors and evidence…"
          aria-label="Ask Asset AI about your assets"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
        />
        <Button type="submit" size="icon" className="size-[34px]" aria-label="Ask">
          <Send className="size-[14px]" />
        </Button>
      </form>
    </section>
  )
}
