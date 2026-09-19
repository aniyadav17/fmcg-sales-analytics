/** Reusable "report views" composed from the engine primitives. */
import type { Dataset } from '../data/types'
import { priorPeriod, type Filters } from '../state/filters'
import { aggregate, dimContext, dimName, dimCode, growth, pct, targets, type Dim, type Scope, type TargetDim } from './engine'

export interface PerfRow {
  k: number
  name: string
  code: string
  context: string
  sales: number      // on selected basis
  prior: number      // same period LY
  growth: number
  change: number
  qty: number
  margin: number
  marginPct: number
  secNet: number     // net secondary (target comparison basis)
  target: number     // NaN when not available
  ach: number
  variance: number
  lines: number
  contribution: number
}

const TARGET_DIMS = new Set<Dim>(['total', 'month', 'region', 'state', 'territory', 'distributor', 'salesperson', 'category', 'brand', 'subCategory', 'sku'])

export function perfByDim(ds: Dataset, sc: Scope, f: Filters, dim: Dim, opts: { from?: number; to?: number; keepZero?: boolean } = {}): PerfRow[] {
  const from = opts.from ?? f.from, to = opts.to ?? f.to
  const cur = aggregate(ds, sc, { from, to, types: f.basis, by: dim })
  const pp = priorPeriod({ from, to })
  const prev = pp ? aggregate(ds, sc, { ...pp, types: f.basis, by: dim }) : null
  const sec = f.basis === 'net_secondary' ? cur : aggregate(ds, sc, { from, to, types: 'net_secondary', by: dim })
  const tgt = TARGET_DIMS.has(dim) ? targets(ds, sc, from, to, dim as TargetDim) : null
  let total = 0
  for (let k = 0; k < cur.n; k++) total += cur.net[k]
  const rows: PerfRow[] = []
  for (let k = 0; k < cur.n; k++) {
    const s = cur.net[k], p = prev ? prev.net[k] : NaN
    const t = tgt ? tgt[k] : NaN
    if (!opts.keepZero && !s && !(p > 0) && !(t > 0)) continue
    rows.push({
      k, name: dimName(ds, dim, k), code: dimCode(ds, dim, k), context: dimContext(ds, dim, k),
      sales: s, prior: p, growth: growth(s, p), change: s - (Number.isNaN(p) ? 0 : p),
      qty: cur.qty[k], margin: s - cur.cost[k], marginPct: pct(s - cur.cost[k], s),
      secNet: sec.net[k], target: t, ach: t > 0 ? (sec.net[k] / t) * 100 : NaN, variance: t > 0 ? sec.net[k] - t : NaN,
      lines: cur.lines[k], contribution: pct(s, total),
    })
  }
  return rows
}

/** Monthly series for the given window: basis sales, prior-year sales, primary, net secondary, target. */
export function monthlySeries(ds: Dataset, sc: Scope, f: Filters, from: number, to: number) {
  const cur = aggregate(ds, sc, { from, to, types: f.basis, by: 'month' })
  const pFrom = Math.max(0, from - 12)
  const prev = from - 12 <= to - 12 && to - 12 >= 0 ? aggregate(ds, sc, { from: pFrom, to: to - 12, types: f.basis, by: 'month' }) : null
  const prim = aggregate(ds, sc, { from, to, types: 'primary', by: 'month' })
  const sec = aggregate(ds, sc, { from, to, types: 'net_secondary', by: 'month' })
  const tgt = targets(ds, sc, from, to, 'month')
  const out = []
  for (let m = from; m <= to; m++) {
    const py = prev && m - 12 >= 0 ? prev.net[m - 12] : null
    out.push({
      m, label: ds.months[m] ? labelOf(m) : '',
      sales: cur.net[m], prior: py, primary: prim.net[m], secondary: sec.net[m], target: tgt ? tgt[m] : null,
      ach: tgt && tgt[m] ? (sec.net[m] / tgt[m]) * 100 : null, margin: cur.net[m] - cur.cost[m],
    })
  }
  return out
}

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const labelOf = (m: number) => `${MN[m % 12]} ${String(21 + Math.floor(m / 12))}`

/** Window used for trend charts: the selected period, widened to 12 months when shorter than 6. */
export function trendWindow(f: Filters) {
  return f.to - f.from < 5 ? { from: Math.max(0, f.to - 11), to: f.to } : { from: f.from, to: f.to }
}
