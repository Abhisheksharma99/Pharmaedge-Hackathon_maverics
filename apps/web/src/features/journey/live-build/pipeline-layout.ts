import type { JobStep } from '@/features/jobs/api'
import { collectionMeta } from '../constants'

/**
 * Agent pipeline geometry (design_files/aj/graph.jsx; node coordinates are final): a fixed 1100×470 design space,
 * scaled to the panel width. Node keys: `s:` source step, `c:` record collection, `r:` reasoning step, `o:` output.
 */
export const AG_W = 1100
export const AG_H = 470
export const AG_OFF = 30

export const AG_SRC = [
  'regulatory',
  'ema_chmp',
  'fda_calendar',
  'clinical',
  'publications',
  'conferences',
  'patents',
  'company_site',
  'company_news',
  'news',
  'industry_news',
  'competitors',
] as const
export const AG_COLL = [
  'fda_records',
  'ema_records',
  'trial_records',
  'publication_records',
  'conference_records',
  'patent_records',
  'company_records',
  'articles',
] as const
export const AG_REASON = ['journey', 'ai_triage', 'ai_events', 'index'] as const

/** Which collections each source step writes to. */
const AG_SRC_COLL: Record<string, string[]> = {
  regulatory: ['fda_records', 'ema_records'],
  ema_chmp: ['ema_records'],
  fda_calendar: ['fda_records'],
  clinical: ['trial_records'],
  publications: ['publication_records'],
  conferences: ['conference_records'],
  patents: ['patent_records'],
  company_site: ['company_records'],
  company_news: ['company_records'],
  news: ['articles'],
  industry_news: ['articles'],
}
const AG_RULES_IN = ['fda_records', 'ema_records', 'trial_records', 'patent_records']
const AG_TRIAGE_IN = ['publication_records', 'conference_records', 'company_records', 'articles']

/** Column headings and their x. */
export const AG_COLUMNS: [label: string, x: number][] = [
  ['Source agents', 16],
  ['Record store', 300],
  ['Reasoning', 548],
  ['Outputs', 846],
]

export interface NodeBox {
  x: number
  y: number
  w: number
  h: number
}

function agLayout(): Record<string, NodeBox> {
  const n: Record<string, NodeBox> = {}
  const o = AG_OFF
  AG_SRC.forEach((k, i) => (n[`s:${k}`] = { x: 16, y: o + i * 34, w: 206, h: 28 }))
  AG_COLL.forEach((k, i) => (n[`c:${k}`] = { x: 300, y: o + 14 + i * 46, w: 176, h: 38 }))
  n['r:journey'] = { x: 548, y: o + 14, w: 228, h: 60 }
  n['r:ai_triage'] = { x: 548, y: o + 120, w: 228, h: 60 }
  n['r:ai_events'] = { x: 548, y: o + 214, w: 228, h: 60 }
  n['r:index'] = { x: 548, y: o + 318, w: 228, h: 60 }
  n['o:journey'] = { x: 846, y: o, w: 240, h: 230 }
  n['o:assetai'] = { x: 846, y: o + 244, w: 240, h: 70 }
  n['o:compset'] = { x: 846, y: o + 326, w: 240, h: 88 }
  return n
}
export const AG_NODES: Record<string, NodeBox> = agLayout()

export interface AgentEdge {
  id: string
  from: string
  to: string
  /** The edge is active while any of these steps runs, done once the first has finished. */
  steps: string[]
  color: string
  /** SVG path in design-space coordinates. */
  d: string
  /** Index edges: thinner, more transparent particles. */
  faint?: boolean
}

interface EdgeSpec {
  from: string
  to: string
  steps: string[]
  color: string
  /** y offset of the end point inside the target node (default: its middle). */
  ty?: number
  vertical?: boolean
  under?: boolean
  faint?: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Cubic edge from the right side of `a` to the left side of `b`; `vertical` drops from a's bottom; `under` loops below. */
export function agPath(a: NodeBox, b: NodeBox, e: Pick<EdgeSpec, 'ty' | 'vertical' | 'under'>): string {
  if (e.vertical) {
    const x = a.x + a.w / 2
    return `M${x},${a.y + a.h} C${x},${a.y + a.h + 14} ${x},${b.y - 14} ${x},${b.y}`
  }
  const x1 = a.x + a.w
  const y1 = a.y + a.h / 2
  const x2 = b.x
  const y2 = e.ty != null ? b.y + e.ty : b.y + b.h / 2
  if (e.under) return `M${x1},${y1} C${x1 + 200},${y1 + 52} ${x2 - 260},${y2 + 52} ${x2},${y2}`
  const dx = (x2 - x1) * 0.55
  return `M${x1},${y1} C${r2(x1 + dx)},${y1} ${r2(x2 - dx)},${y2} ${x2},${y2}`
}

function agEdges(): AgentEdge[] {
  const specs: EdgeSpec[] = []
  const color = (c: string) => collectionMeta(c).color
  AG_SRC.forEach((s) => (AG_SRC_COLL[s] ?? []).forEach((c) => specs.push({ from: `s:${s}`, to: `c:${c}`, steps: [s], color: color(c) })))
  AG_RULES_IN.forEach((c, i) => specs.push({ from: `c:${c}`, to: 'r:journey', steps: ['journey', 'finalize'], color: color(c), ty: 14 + i * 11 }))
  AG_TRIAGE_IN.forEach((c, i) => specs.push({ from: `c:${c}`, to: 'r:ai_triage', steps: ['ai_triage'], color: color(c), ty: 14 + i * 11 }))
  specs.push({ from: 'r:ai_triage', to: 'r:ai_events', steps: ['ai_events'], color: '#7a5af8', vertical: true })
  AG_COLL.forEach((c, i) => specs.push({ from: `c:${c}`, to: 'r:index', steps: ['index'], color: color(c), ty: 12 + i * 5, faint: true }))
  specs.push({ from: 'r:journey', to: 'o:journey', steps: ['journey', 'finalize'], color: '#2347d9', ty: 58 })
  specs.push({ from: 'r:ai_events', to: 'o:journey', steps: ['ai_events'], color: '#7a5af8', ty: 168 })
  specs.push({ from: 'r:index', to: 'o:assetai', steps: ['index'], color: '#475467' })
  specs.push({ from: 's:competitors', to: 'o:compset', steps: ['competitors'], color: '#e0620f', under: true })
  return specs.map((e, i) => ({
    id: `age-${i}`,
    from: e.from,
    to: e.to,
    steps: e.steps,
    color: e.color,
    d: agPath(AG_NODES[e.from]!, AG_NODES[e.to]!, e),
    ...(e.faint && { faint: true }),
  }))
}
export const AG_EDGES: AgentEdge[] = agEdges()

export type EdgeState = 'pending' | 'active' | 'done'

/** Active while one of the edge's steps runs; done once its first planned step has finished; pending otherwise. */
export function edgeState(steps: string[], byName: ReadonlyMap<string, Pick<JobStep, 'status'>>): EdgeState {
  const planned = steps.flatMap((n) => {
    const s = byName.get(n)
    return s ? [s] : []
  })
  if (planned.some((s) => s.status === 'running')) return 'active'
  const first = planned[0]
  return first && first.status !== 'pending' ? 'done' : 'pending'
}

/**
 * Which nodes exist for this job: source and reasoning nodes for the steps in its plan, a collection once it holds
 * a record, an output when a step that feeds it is planned.
 */
export function nodeVisible(key: string, plan: ReadonlySet<string>, records: Readonly<Record<string, number>>): boolean {
  const [kind, name = ''] = key.split(':')
  if (kind === 's' || kind === 'r') return plan.has(name)
  if (kind === 'c') return (records[name] ?? 0) > 0
  if (key === 'o:journey') return plan.has('journey') || plan.has('ai_events') || plan.has('finalize')
  if (key === 'o:assetai') return plan.has('index')
  if (key === 'o:compset') return plan.has('competitors')
  return false
}
