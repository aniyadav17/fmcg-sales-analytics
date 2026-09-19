import type { Dataset } from '../data/types'
import type { Scope } from './engine'

export const AGE_BUCKETS = ['Not yet due', '0-30', '31-60', '61-90', '90+'] as const
export type CollDim = 'total' | 'region' | 'state' | 'distributor'

export interface CollStats {
  n: number
  invoiced: Float64Array            // invoices raised in the period
  collectedOnInvoices: Float64Array // amount collected (as of period end) against invoices raised in the period
  collected: Float64Array           // cash received during the period (any invoice)
  opening: Float64Array             // outstanding at period start
  outstanding: Float64Array         // outstanding at period end (all invoices)
  overdue: Float64Array             // outstanding past due date at period end
  ageing: Float64Array[]            // [bucket] -> by key
  daysToCollectW: Float64Array      // sum(amount x days from invoice to payment) for payments in period
  maxOverdueDays: Float64Array
  invoices: Float64Array
}

const NONE = 65535

function keyFn(ds: Dataset, dim: CollDim): { n: number; key: (d: number) => number } {
  switch (dim) {
    case 'total': return { n: 1, key: () => 0 }
    case 'region': return { n: ds.counts.region, key: d => ds.distRegion[d] }
    case 'state': return { n: ds.counts.state, key: d => ds.distState[d] }
    case 'distributor': return { n: ds.counts.distributor, key: d => d }
  }
}

/** Receivables on primary invoices. Report date = last day of the `to` month. */
export function collectionStats(ds: Dataset, sc: Scope, from: number, to: number, dim: CollDim = 'total'): CollStats {
  const c = ds.coll
  const kf = keyFn(ds, dim)
  const z = () => new Float64Array(kf.n)
  const r: CollStats = {
    n: kf.n, invoiced: z(), collectedOnInvoices: z(), collected: z(), opening: z(), outstanding: z(), overdue: z(),
    ageing: AGE_BUCKETS.map(() => z()), daysToCollectW: z(), maxOverdueDays: z(), invoices: z(),
  }
  const fromDay = ds.monthStartDay[from]
  const asOf = ds.monthStartDay[to + 1] - 1
  for (let i = 0; i < c.n; i++) {
    const d = c.dist[i]
    if (!sc.primaryDistOK[d]) continue
    const inv = c.invDay[i]
    if (inv > asOf) break // invoices are sorted by date
    const k = kf.key(d)
    const amt = c.amount[i]
    const p1 = c.pay1Day[i], p2 = c.pay2Day[i]
    const a1 = c.pay1Amt[i], a2 = c.pay2Amt[i]
    const paidBy = (day: number) => (p1 !== NONE && p1 <= day ? a1 : 0) + (p2 !== NONE && p2 <= day ? a2 : 0)
    if (inv < fromDay) r.opening[k] += Math.max(0, amt - paidBy(fromDay - 1))
    else {
      r.invoiced[k] += amt
      r.invoices[k] += 1
      r.collectedOnInvoices[k] += paidBy(asOf)
    }
    for (const [pd, pa] of [[p1, a1], [p2, a2]] as const) {
      if (pd !== NONE && pa > 0 && pd >= fromDay && pd <= asOf) {
        r.collected[k] += pa
        r.daysToCollectW[k] += pa * (pd - inv)
      }
    }
    const out = amt - paidBy(asOf)
    if (out > 0.5) {
      r.outstanding[k] += out
      const od = asOf - c.dueDay[i]
      if (od <= 0) r.ageing[0][k] += out
      else {
        r.overdue[k] += out
        r.ageing[od <= 30 ? 1 : od <= 60 ? 2 : od <= 90 ? 3 : 4][k] += out
        if (od > r.maxOverdueDays[k]) r.maxOverdueDays[k] = od
      }
    }
  }
  return r
}

/** Collection efficiency (CEI) = (opening + invoiced - closing) / (opening + invoiced). */
export const cei = (opening: number, invoiced: number, closing: number) =>
  opening + invoiced > 0 ? ((opening + invoiced - closing) / (opening + invoiced)) * 100 : NaN

/** Monthly invoiced vs collected trend. */
export function collectionTrend(ds: Dataset, sc: Scope, from: number, to: number) {
  const c = ds.coll
  const nM = ds.months.length
  const invoiced = new Float64Array(nM), collected = new Float64Array(nM)
  const dayToMonth = (day: number) => {
    let lo = 0, hi = nM - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ds.monthStartDay[mid] <= day) lo = mid; else hi = mid - 1 }
    return lo
  }
  for (let i = 0; i < c.n; i++) {
    if (!sc.primaryDistOK[c.dist[i]]) continue
    const m = dayToMonth(c.invDay[i])
    if (m >= from && m <= to) invoiced[m] += c.amount[i]
    for (const [pd, pa] of [[c.pay1Day[i], c.pay1Amt[i]], [c.pay2Day[i], c.pay2Amt[i]]] as const) {
      if (pd === NONE || pa <= 0) continue
      const pm = dayToMonth(pd)
      if (pm >= from && pm <= to && pd < ds.monthStartDay[nM]) collected[pm] += pa
    }
  }
  return { invoiced, collected }
}
