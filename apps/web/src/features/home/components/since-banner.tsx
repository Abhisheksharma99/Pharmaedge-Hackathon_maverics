import { NewDot } from './new-dot'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "12 new events since Tue 14:05 across 4 assets" · Show: a slim strip under the hero; Show lists them in What changed. */
export function SinceBanner({ count, assets, since, showing, onShow }: { count: number; assets: number; since: string; showing: boolean; onShow: () => void }) {
  return (
    <div
      role="status"
      aria-label="Since your last visit"
      className="flex min-w-0 flex-[1_1_360px] animate-fade-up items-center gap-[10px] rounded-[10px] border border-primary/20 bg-primary-soft py-[6px] pr-[6px] pl-[12px]"
    >
      <NewDot />
      <p className="min-w-0 flex-1 text-pretty text-secondary-foreground">
        <b className="font-semibold text-foreground">{plural(count, 'new event')}</b> since {since} across {plural(assets, 'asset')}
      </p>
      <button
        type="button"
        aria-pressed={showing}
        onClick={onShow}
        className="h-[28px] shrink-0 rounded-[7px] px-[10px] text-[12.5px] font-semibold text-primary hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {showing ? 'Show all events' : 'Show'}
      </button>
    </div>
  )
}
