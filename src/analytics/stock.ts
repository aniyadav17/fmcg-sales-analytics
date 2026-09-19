import type { Dataset } from '../data/types'
import type { Scope } from './engine'

export type StockStatus = 'Stock-out' | 'Low Stock' | 'Healthy' | 'Overstock' | 'Slow-moving' | 'Non-moving'
export const STOCK_STATUSES: StockStatus[] = ['Stock-out', 'Low Stock', 'Healthy', 'Overstock', 'Slow-moving', 'Non-moving']

/** Stock-norm thresholds in days of cover (distributor stock norm = 7-45 days). */
export const STOCK_NORMS = { low: 7, over: 45, slow: 90, nonMovingDays: 90 }

/** The four management buckets used on the exception tiles. */
export type StockBucket = 'Stock-out' | 'Low Stock' | 'Overstock' | 'Healthy'
export const bucketOf = (s: StockStatus): StockBucket =>
  s === 'Stock-out' ? 'Stock-out' : s === 'Low Stock' ? 'Low Stock' : s === 'Healthy' ? 'Healthy' : 'Overstock'

export interface StockRow {
  dist: number
  sku: number
  closing: number
  value: number
  /** secondary units sold in the last 3 months (incl. snapshot month) */
  sales3m: number
  salesValue3m: number
  /** days of stock = closing / average daily sales of last 3 months */
  dos: number
  status: StockStatus
  ageValue: [number, number, number, number] // 0-30, 31-60, 61-90, 90+ days
}

export function classify(closing: number, sales3m: number): { dos: number; status: StockStatus } {
  const daily = sales3m / 91
  const dos = daily > 0 ? closing / daily : closing > 0 ? Infinity : 0
  let status: StockStatus
  if (closing <= 0) status = 'Stock-out'
  else if (sales3m <= 0) status = 'Non-moving'
  else if (dos > STOCK_NORMS.slow) status = 'Slow-moving'
  else if (dos > STOCK_NORMS.over) status = 'Overstock'
  else if (dos < STOCK_NORMS.low) status = 'Low Stock'
  else status = 'Healthy'
  return { dos, status }
}

/** Distributor x SKU secondary units & value for months [from..to] (distributor-level scope). */
export function distSkuSales(ds: Dataset, sc: Scope, from: number, to: number) {
  const s = ds.sales
  const nS = ds.counts.sku
  const qty = new Float64Array(ds.counts.distributor * nS)
  const val = new Float64Array(ds.counts.distributor * nS)
  const a = Math.max(0, from)
  for (let i = s.monthStart[a]; i < s.monthStart[to + 1]; i++) {
    if (s.stype[i] !== 1) continue
    const d = s.dist[i], k = s.sku[i]
    if (!sc.primaryDistOK[d] || !sc.skuOK[k]) continue
    qty[d * nS + k] += s.qty[i]
    val[d * nS + k] += s.net[i]
  }
  return { qty, val }
}

/** Stock snapshot at a month end. Stock is held by distributors, so outlet-level filters do not apply. */
export function stockSnapshot(ds: Dataset, sc: Scope, month: number): StockRow[] {
  const st = ds.stock
  const nS = ds.counts.sku
  const pp = ds.monthPricePeriod[month]
  const sales = distSkuSales(ds, sc, month - 2, month)
  const rows: StockRow[] = []
  for (let i = st.monthStart[month]; i < st.monthStart[month + 1]; i++) {
    const d = st.dist[i], k = st.sku[i]
    if (!sc.primaryDistOK[d] || !sc.skuOK[k]) continue
    const closing = st.closing[i]
    const price = ds.ptd[k * 6 + pp]
    const s3 = sales.qty[d * nS + k]
    const { dos, status } = classify(closing, s3)
    const a0 = st.age0[i], a1 = st.age1[i], a2 = st.age2[i]
    const a3 = Math.max(0, closing - a0 - a1 - a2)
    rows.push({
      dist: d, sku: k, closing, value: closing * price, sales3m: s3, salesValue3m: sales.val[d * nS + k], dos, status,
      ageValue: [a0 * price, a1 * price, a2 * price, a3 * price],
    })
  }
  return rows
}

/** Month-end stock value by month (and optionally by distributor). */
export function stockValueTrend(ds: Dataset, sc: Scope, from: number, to: number, byDist = false): Float64Array {
  const st = ds.stock
  const nD = ds.counts.distributor
  const nM = ds.months.length
  const out = new Float64Array(byDist ? nD * nM : nM)
  for (let m = Math.max(0, from); m <= to; m++) {
    const pp = ds.monthPricePeriod[m]
    for (let i = st.monthStart[m]; i < st.monthStart[m + 1]; i++) {
      const d = st.dist[i], k = st.sku[i]
      if (!sc.primaryDistOK[d] || !sc.skuOK[k]) continue
      const v = st.closing[i] * ds.ptd[k * 6 + pp]
      out[byDist ? d * nM + m : m] += v
    }
  }
  return out
}

export interface StockSummary {
  value: number; units: number; combos: number; stockOuts: number; low: number; healthy: number; over: number; slow: number; nonMoving: number
  valueByStatus: Record<StockStatus, number>; countByStatus: Record<StockStatus, number>
  ageValue: [number, number, number, number]; coverDays: number; stockOutPct: number; sales3mValue: number
}

export function summarizeStock(rows: StockRow[], ds: Dataset, month: number): StockSummary {
  const valueByStatus = Object.fromEntries(['Stock-out', 'Low Stock', 'Healthy', 'Overstock', 'Slow-moving', 'Non-moving'].map(s => [s, 0])) as Record<StockStatus, number>
  const countByStatus = { ...valueByStatus }
  const ageValue: [number, number, number, number] = [0, 0, 0, 0]
  let value = 0, units = 0, dailyCostOfSales = 0, sales3mValue = 0
  const pp = ds.monthPricePeriod[month]
  for (const r of rows) {
    value += r.value; units += r.closing
    valueByStatus[r.status] += r.value
    countByStatus[r.status] += 1
    for (let b = 0; b < 4; b++) ageValue[b] += r.ageValue[b]
    dailyCostOfSales += (r.sales3m * ds.ptd[r.sku * 6 + pp]) / 91
    sales3mValue += r.salesValue3m
  }
  return {
    value, units, combos: rows.length, valueByStatus, countByStatus, ageValue,
    stockOuts: countByStatus['Stock-out'], low: countByStatus['Low Stock'], healthy: countByStatus.Healthy,
    over: countByStatus.Overstock, slow: countByStatus['Slow-moving'], nonMoving: countByStatus['Non-moving'],
    coverDays: dailyCostOfSales > 0 ? value / dailyCostOfSales : NaN,
    stockOutPct: rows.length ? (countByStatus['Stock-out'] / rows.length) * 100 : NaN,
    sales3mValue,
  }
}
