/**
 * Share-price reaction around an asset's journey events (port of patent_intel/market/impact.py: same rules, pure).
 *
 * Prices: `market_prices` (one doc per ticker, adjusted daily closes) and listings: `market_listings` (which tickers
 * belong to the asset's company), both written by the crawler's `market` step (crawler/integrations/market.py).
 *
 * Day 0 = the first trading day on/after the event date (a weekend PDUFA date counts from Monday). Every move is the
 * % change of a close against the last close BEFORE day 0, so day 0 includes the event-day reaction. Moves show
 * timing only - never that the event caused them.
 */

export const MARKET_NOTE = 'Moves are measured after each event date; they show timing, not that the event caused the move.';
const HORIZON = 20; // trading days measured after day 0

export interface Bar {
  date: string;
  close: number;
}

export interface Impact {
  trading_day: string;
  base_close: number;
  days_measured: number;
  day0: number;
  day5: number | null;
  day20: number | null;
  dip: number | null;
  /** Trading days after day 0 of the deepest dip / highest peak, and the close that day. */
  dip_day: number | null;
  dip_close: number | null;
  peak: number | null;
  peak_day: number | null;
  peak_close: number | null;
}

const pct = (a: number, b: number) => Math.round((a / b - 1) * 10000) / 100;

/** First index whose date is >= `date` (bars ascending). */
function firstOnOrAfter(bars: Bar[], date: string): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function measure(bars: Bar[], date: string, today: string): { impact: Impact | null; note: string | null } {
  const i = firstOnOrAfter(bars, date);
  if (!bars.length) return { impact: null, note: 'no price history' };
  if (i === 0) return { impact: null, note: 'before price history' };
  if (i === bars.length) return { impact: null, note: date > today ? 'upcoming' : 'no trading day after it yet' };
  const base = bars[i - 1]!.close;
  const win = bars.slice(i, i + HORIZON + 1);
  const moves = win.map((b) => pct(b.close, base));
  const lo = moves.indexOf(Math.min(...moves));
  const hi = moves.indexOf(Math.max(...moves));
  const dip = moves[lo]! < 0;
  const peak = moves[hi]! > 0;
  return {
    note: null,
    impact: {
      trading_day: bars[i]!.date, base_close: base, days_measured: moves.length - 1, day0: moves[0]!,
      day5: moves.length > 5 ? moves[5]! : null, day20: moves.length > 20 ? moves[20]! : null,
      dip: dip ? moves[lo]! : null, dip_day: dip ? lo : null, dip_close: dip ? win[lo]!.close : null,
      peak: peak ? moves[hi]! : null, peak_day: peak ? hi : null, peak_close: peak ? win[hi]!.close : null,
    },
  };
}
