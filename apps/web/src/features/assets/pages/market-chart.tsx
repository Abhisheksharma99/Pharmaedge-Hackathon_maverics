import { useEffect, useRef } from 'react'
import {
  AreaSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts'
import type { MarketEvent } from '../api'

/**
 * Price chart of the Market tab (TradingView Lightweight Charts; loaded lazily with the tab). One arrow per trading
 * day with events (events on the same day share day 0, so they share the move), labelled with the +5-day move once
 * few enough are on screen to read; hovering a day reports its events, clicking selects the first. The selected
 * event's marker grows, the view zooms in and draws the close before it, its deepest dip and highest peak.
 */

export type MeasuredEvent = MarketEvent & { impact: NonNullable<MarketEvent['impact']> }

const LABELS_UP_TO = 30 // markers on screen; more and the labels overlap
const sign = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
export const moveOf = (e: MeasuredEvent) => e.impact.day5 ?? e.impact.day0

/** Lightweight Charts hands back the time in the form it was given or as a business day: normalise to YYYY-MM-DD. */
function isoDay(t: Time | undefined): string | null {
  if (t === undefined) return null
  if (typeof t === 'string') return t
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10)
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

// The light theme's tokens (--chart-1, --success, --destructive, --muted-foreground, --border) as hex: the canvas
// needs concrete colours.
const C = { line: '#2347d9', up: '#0b7a6f', down: '#b42318', muted: '#667085', grid: '#eaecf0' }

export default function MarketChart({
  bars,
  events,
  selected,
  onSelect,
  onHover,
}: {
  bars: { date: string; close: number }[]
  events: MeasuredEvent[]
  selected: MeasuredEvent | null
  onSelect: (e: MeasuredEvent) => void
  onHover: (events: MeasuredEvent[] | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const chartRef = useRef<{ chart: IChartApi; series: ISeriesApi<'Area'>; index: Map<string, number>; draw: () => void } | null>(null)
  const selectedDay = useRef<string | null>(null)
  selectedDay.current = selected?.impact.trading_day ?? null
  const handlers = useRef({ onSelect, onHover })
  handlers.current = { onSelect, onHover }

  useEffect(() => {
    if (!box.current) return
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { textColor: C.muted, background: { color: 'transparent' }, fontFamily: 'inherit' },
      grid: { vertLines: { visible: false }, horzLines: { color: C.grid } },
      timeScale: { borderColor: C.grid },
      rightPriceScale: { borderColor: C.grid },
    })
    const series = chart.addSeries(AreaSeries, {
      lineColor: C.line,
      lineWidth: 2,
      topColor: `${C.line}26`,
      bottomColor: `${C.line}00`,
      priceLineVisible: false,
    })
    series.setData(bars.map((b) => ({ time: b.date, value: b.close })))

    const index = new Map(bars.map((b, i) => [b.date, i]))
    const byDay = new Map<string, MeasuredEvent[]>()
    for (const e of events) byDay.set(e.impact.trading_day, [...(byDay.get(e.impact.trading_day) ?? []), e])
    const days = [...byDay.keys()].sort()
    const markers = createSeriesMarkers(series, [])
    const readable = (range: { from: number; to: number } | null) =>
      (range ? days.filter((d) => index.get(d)! >= range.from && index.get(d)! <= range.to).length : days.length) <= LABELS_UP_TO
    let labelled: boolean | null = null
    const draw = () => {
      labelled = readable(chart.timeScale().getVisibleLogicalRange())
      markers.setMarkers(
        days.map((day) => {
          const move = moveOf(byDay.get(day)![0]!)
          const rise = move >= 0
          return {
            time: day,
            position: rise ? ('belowBar' as const) : ('aboveBar' as const),
            shape: rise ? ('arrowUp' as const) : ('arrowDown' as const),
            color: rise ? C.up : C.down,
            size: day === selectedDay.current ? 2 : 1,
            text: labelled ? sign(move) : '',
          }
        }),
      )
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && readable(range) !== labelled) draw() // redraw only when labels switch on or off
    })
    chart.subscribeClick((p) => {
      const es = byDay.get(isoDay(p.time) ?? '')
      if (es) handlers.current.onSelect(es[0]!)
    })
    chart.subscribeCrosshairMove((p) => handlers.current.onHover(byDay.get(isoDay(p.time) ?? '') ?? null))
    chart.timeScale().fitContent()
    draw()
    chartRef.current = { chart, series, index, draw }
    return () => {
      chartRef.current = null
      chart.remove()
    }
  }, [bars, events])

  useEffect(() => {
    const c = chartRef.current
    if (!c) return
    c.draw() // grow the selected day's marker
    if (!selected) {
      c.chart.timeScale().fitContent()
      return
    }
    const m = selected.impact
    const lines: IPriceLine[] = [
      c.series.createPriceLine({ price: m.base_close, color: C.muted, lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'close before' }),
    ]
    if (m.dip !== null && m.dip_close !== null)
      lines.push(c.series.createPriceLine({ price: m.dip_close, color: C.down, lineWidth: 2, lineStyle: LineStyle.Dashed, title: `dip ${sign(m.dip)}` }))
    if (m.peak !== null && m.peak_close !== null)
      lines.push(c.series.createPriceLine({ price: m.peak_close, color: C.up, lineWidth: 2, lineStyle: LineStyle.Dashed, title: `peak ${sign(m.peak)}` }))
    const i = c.index.get(m.trading_day)
    if (i !== undefined) c.chart.timeScale().setVisibleLogicalRange({ from: i - 15, to: i + 30 })
    return () => lines.forEach((l) => c.series.removePriceLine(l))
  }, [selected, bars, events])

  return <div ref={box} className="h-80 w-full" role="img" aria-label="Share price with event markers" />
}
