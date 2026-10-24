import type { CardData } from './card-data'

/** The PNG's pixel ratio. */
export const PNG_SCALE = 2
/** Room around the chart: value labels sit above the plot (the page shows them with overflow: visible). */
const CHART_PAD = 12
const PAD = 20
const LEGEND_ROW = 18

/** Presentation properties the page sets through CSS classes, which don't reach an SVG drawn as an image. */
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
]

/** The card's chart, when it is drawn as SVG (charts carry role="img"; icons don't). */
export function chartSvg(root: ParentNode | null | undefined): SVGSVGElement | null {
  return root?.querySelector<SVGSVGElement>('svg[role="img"]') ?? null
}

/**
 * The chart as standalone SVG markup at `scale`: computed styles inlined, classes and inline animation styles dropped,
 * and a margin of CHART_PAD so labels drawn outside the plot area are kept.
 */
export function svgMarkup(svg: SVGSVGElement, scale = PNG_SCALE): { markup: string; width: number; height: number } {
  const rect = svg.getBoundingClientRect()
  const w = rect.width || Number(svg.getAttribute('width')) || 300
  const h = rect.height || Number(svg.getAttribute('height')) || 150
  const clone = svg.cloneNode(true) as SVGSVGElement
  const from = [svg, ...svg.querySelectorAll('*')]
  const to = [clone, ...clone.querySelectorAll('*')]
  from.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const out = to[i]!
    const style = STYLE_PROPS.map((p) => [p, cs.getPropertyValue(p)] as const)
      .filter(([, v]) => v !== '')
      .map(([p, v]) => `${p}:${v}`)
      .join(';')
    out.removeAttribute('class')
    if (style) out.setAttribute('style', style)
    else out.removeAttribute('style')
  })
  const width = w + CHART_PAD * 2
  const height = h + CHART_PAD * 2
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!svg.getAttribute('viewBox')) clone.setAttribute('viewBox', `${-CHART_PAD} ${-CHART_PAD} ${width} ${height}`)
  clone.setAttribute('width', String(width * scale))
  clone.setAttribute('height', String(height * scale))
  clone.removeAttribute('role')
  return { markup: new XMLSerializer().serializeToString(clone), width, height }
}

export interface PngCaption {
  title: string
  /** "Treprostinil · 2026-10-24": the asset and the export date. */
  caption: string
  legend?: CardData['legend']
  colors: { bg: string; fg: string; muted: string }
  font: string
}

/** Legend items laid out in rows no wider than `max` (CSS px), measured with the canvas font. */
function legendRows(ctx: CanvasRenderingContext2D, items: NonNullable<CardData['legend']>, max: number) {
  const rows: { l: string; c: string; x: number }[][] = [[]]
  let x = 0
  for (const it of items) {
    const w = 14 + ctx.measureText(it.l).width + 14
    if (x > 0 && x + w > max) {
      rows.push([])
      x = 0
    }
    rows.at(-1)!.push({ ...it, x })
    x += w
  }
  return rows.filter((r) => r.length)
}

/** The card as a PNG at PNG_SCALE: title, asset and date above the chart, its colour key below. */
export async function cardPng(svg: SVGSVGElement, c: PngCaption): Promise<Blob> {
  const { markup, width: chartW, height: chartH } = svgMarkup(svg)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  await img.decode()

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw images.')
  ctx.font = `600 15px ${c.font}`
  const titleW = ctx.measureText(c.title).width
  const width = Math.ceil(Math.max(chartW, titleW + PAD, 320) + PAD * 2)
  ctx.font = `12px ${c.font}`
  const legend = c.legend?.length ? legendRows(ctx, c.legend, width - PAD * 2) : []
  const chartY = PAD + 44
  const height = Math.ceil(chartY + chartH + legend.length * LEGEND_ROW + PAD)

  canvas.width = width * PNG_SCALE
  canvas.height = height * PNG_SCALE
  ctx.scale(PNG_SCALE, PNG_SCALE)
  ctx.fillStyle = c.colors.bg
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = c.colors.fg
  ctx.font = `600 15px ${c.font}`
  ctx.fillText(c.title, PAD, PAD + 14)
  ctx.fillStyle = c.colors.muted
  ctx.font = `12px ${c.font}`
  ctx.fillText(c.caption, PAD, PAD + 32)
  ctx.drawImage(img, PAD - CHART_PAD + Math.max(0, (width - PAD * 2 - chartW) / 2), chartY, chartW, chartH)
  legend.forEach((row, i) => {
    const y = chartY + chartH + i * LEGEND_ROW + 12
    for (const it of row) {
      ctx.fillStyle = it.c
      ctx.fillRect(PAD + it.x, y - 8, 8, 8)
      ctx.fillStyle = c.colors.muted
      ctx.fillText(it.l, PAD + it.x + 14, y)
    }
  })

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be encoded.'))), 'image/png'))
}

/** `treprostinil-trials-by-phase-2026-10-24`: letters, digits and dashes. */
export const fileStem = (...parts: string[]) =>
  parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
