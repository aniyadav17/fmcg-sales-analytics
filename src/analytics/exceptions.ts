/**
 * Rule-based exception & opportunity detection ("Where should management act?").
 * Every rule is explicit and parameterised so it can be explained in a review
 * and tuned by the business.
 */
import type { Dataset } from '../data/types'
import type { Filters } from '../state/filters'
import { aggregate, growth, outletStats, type Scope } from './engine'
import { perfByDim } from './views'
import { stockSnapshot } from './stock'
import { cei, collectionStats } from './collections'

export type ExcCategory = 'Sales' | 'Stock' | 'Collection' | 'Opportunity'
export type Severity = 'High' | 'Medium' | 'Low'
export type EntityType = 'Region' | 'State' | 'Distributor' | 'Salesperson' | 'Outlet' | 'SKU' | 'Distributor × SKU'

export interface Exception {
  id: string
  category: ExcCategory
  rule: string
  severity: Severity
  entityType: EntityType
  entity: string
  context: string
  metric: string
  impact: number // ₹ at stake (shortfall, value at risk, overdue, or upside)
  action: string
  drill?: { level: 'distributor' | 'salesperson' | 'outlet' | 'state' | 'region'; k: number; name: string }
}

export const RULES = {
  achLow: 80, achVeryLow: 70,
  declineMonths: 3, declineMinPct: 10,
  belowAvgPct: 75,
  productivityLow: 40,
  lowStockDays: 7, slowDays: 90,
  overduePctOfLimit: 25, overdueDays: 60, ceiLow: 75,
  skuGrowth: 25, regionGrowthPremium: 5, spTopAch: 105, strongSecGrowth: 10, thinCover: 15, freqUplift: 1.5, freqMinOrders: 5,
}

export function detectExceptions(ds: Dataset, sc: Scope, f: Filters): Exception[] {
  const out: Exception[] = []
  const M = f.to
  const m = ds.m
  const add = (e: Omit<Exception, 'id'>) => out.push({ ...e, id: `${e.category}-${out.length}` })
  const distCtx = (d: number) => `${m.states.name[ds.distState[d]]} · ${m.regions[ds.distRegion[d]]}`

  // ---------------------------------------------------------------- SALES
  const dists = perfByDim(ds, sc, f, 'distributor')
  const sps = perfByDim(ds, sc, f, 'salesperson')
  for (const r of dists) if (r.ach < RULES.achLow) add({
    category: 'Sales', rule: 'Target achievement < 80%', severity: r.ach < RULES.achVeryLow ? 'High' : 'Medium', entityType: 'Distributor',
    entity: r.name, context: r.context, metric: `Ach ${r.ach.toFixed(1)}% (${fmtL(r.secNet)} of ${fmtL(r.target)})`, impact: -r.variance,
    action: 'Review beat coverage and stock availability; agree a month-wise recovery plan with the distributor.', drill: { level: 'distributor', k: r.k, name: r.name },
  })
  for (const r of sps) if (r.ach < RULES.achLow) add({
    category: 'Sales', rule: 'Target achievement < 80%', severity: r.ach < RULES.achVeryLow ? 'High' : 'Medium', entityType: 'Salesperson',
    entity: r.name, context: r.context, metric: `Ach ${r.ach.toFixed(1)}%`, impact: -r.variance,
    action: 'Joint working by ASM; check outlet productivity and lines per call on weak beats.', drill: { level: 'salesperson', k: r.k, name: r.name },
  })
  if (M >= RULES.declineMonths) {
    const from = M - RULES.declineMonths
    const dm = aggregate(ds, sc, { from, to: M, types: 'net_secondary', by: 'distributor', by2: 'month' })
    const sm = aggregate(ds, sc, { from, to: M, types: 'net_secondary', by: 'sku', by2: 'month' })
    const nM = ds.months.length
    const declining = (arr: Float64Array, k: number) => {
      const v = []; for (let x = from; x <= M; x++) v.push(arr[k * nM + x])
      for (let i = 1; i < v.length; i++) if (!(v[i] < v[i - 1])) return null
      const drop = ((v[0] - v[v.length - 1]) / v[0]) * 100
      return v[0] > 0 && drop >= RULES.declineMinPct ? { drop, v } : null
    }
    for (let d = 0; d < ds.counts.distributor; d++) {
      const x = declining(dm.net, d); if (!x) continue
      add({ category: 'Sales', rule: 'Sales declining 3 consecutive months', severity: x.drop > 30 ? 'High' : 'Medium', entityType: 'Distributor', entity: m.distributors.name[d], context: distCtx(d),
        metric: `−${x.drop.toFixed(0)}% from ${fmtL(x.v[0])} to ${fmtL(x.v[x.v.length - 1])}`, impact: x.v[0] - x.v[x.v.length - 1],
        action: 'Check stock-outs, outlet closures and competitor activity in the territory.', drill: { level: 'distributor', k: d, name: m.distributors.name[d] } })
    }
    for (let s = 0; s < ds.counts.sku; s++) {
      const x = declining(sm.net, s); if (!x || x.v[0] < 50000) continue
      add({ category: 'Sales', rule: 'Sales declining 3 consecutive months', severity: x.drop > 30 ? 'High' : 'Medium', entityType: 'SKU', entity: m.skus.name[s], context: `${m.brands.name[ds.skuBrand[s]]} · ${m.skus.status[s]}`,
        metric: `−${x.drop.toFixed(0)}% over 3 months`, impact: x.v[0] - x.v[x.v.length - 1], action: 'Validate seasonality vs genuine decline; review pricing, visibility and schemes.' })
    }
  }
  if (M >= 6) {
    const hist = aggregate(ds, sc, { from: M - 6, to: M - 1, types: 'net_secondary', by: 'distributor' })
    const cur = aggregate(ds, sc, { from: M, to: M, types: 'net_secondary', by: 'distributor' })
    for (let d = 0; d < ds.counts.distributor; d++) {
      const avg = hist.net[d] / 6
      if (avg > 0 && cur.net[d] < avg * RULES.belowAvgPct / 100) add({
        category: 'Sales', rule: 'Sales below historical average (<75% of 6-month avg)', severity: cur.net[d] < avg * 0.5 ? 'High' : 'Medium', entityType: 'Distributor',
        entity: m.distributors.name[d], context: distCtx(d), metric: `${ds.months[M]}: ${fmtL(cur.net[d])} vs avg ${fmtL(avg)}`, impact: avg - cur.net[d],
        action: 'Call the distributor: stock, credit hold or salesman vacancy?', drill: { level: 'distributor', k: d, name: m.distributors.name[d] } })
    }
  }
  // salesperson productivity (monthly average)
  const months = f.to - f.from + 1
  const prodSum = new Float64Array(ds.counts.salesperson), actSum = new Float64Array(ds.counts.salesperson)
  for (let x = f.from; x <= f.to; x++) {
    const o = outletStats(ds, sc, x, x, 'salesperson')
    for (let k = 0; k < o.n; k++) { prodSum[k] += o.productive[k]; actSum[k] += o.active[k] }
  }
  const spProd = new Float64Array(ds.counts.salesperson)
  for (let k = 0; k < ds.counts.salesperson; k++) {
    spProd[k] = actSum[k] ? (prodSum[k] / actSum[k]) * 100 : NaN
    if (actSum[k] / months >= 5 && spProd[k] < RULES.productivityLow) add({
      category: 'Sales', rule: 'Salesperson productivity below 40%', severity: spProd[k] < 30 ? 'High' : 'Medium', entityType: 'Salesperson', entity: m.salespersons.name[k],
      context: m.distributors.name[ds.spDist[k]], metric: `${spProd[k].toFixed(0)}% of ${(actSum[k] / months).toFixed(0)} outlets billed per month`, impact: 0,
      action: 'Audit beat adherence (visits vs orders); re-route or split low-yield beats.', drill: { level: 'salesperson', k, name: m.salespersons.name[k] } })
  }

  // ---------------------------------------------------------------- STOCK
  const snap = stockSnapshot(ds, sc, M)
  const byDist = new Map<number, { outs: number; atRisk: number; excess: number; value: number; sales: number; cogs: number }>()
  const bySku = new Map<number, { value: number; sales3m: number; cogs: number; outs: number }>()
  const pp = ds.monthPricePeriod[M]
  for (const r of snap) {
    const x = byDist.get(r.dist) ?? { outs: 0, atRisk: 0, excess: 0, value: 0, sales: 0, cogs: 0 }
    x.value += r.value; x.sales += r.salesValue3m; x.cogs += (r.sales3m * ds.ptd[r.sku * 6 + pp]) / 91
    const y = bySku.get(r.sku) ?? { value: 0, sales3m: 0, cogs: 0, outs: 0 }
    y.value += r.value; y.sales3m += r.salesValue3m; y.cogs += (r.sales3m * ds.ptd[r.sku * 6 + pp]) / 91
    if (r.status === 'Stock-out' && r.sales3m > 0) { x.outs++; x.atRisk += r.salesValue3m / 3; y.outs++ }
    if (r.dos > RULES.slowDays) x.excess += r.value
    byDist.set(r.dist, x); bySku.set(r.sku, y)
    if (r.status === 'Stock-out' && r.salesValue3m / 3 > 15000) add({
      category: 'Stock', rule: 'Stock-out on a selling SKU', severity: r.salesValue3m / 3 > 40000 ? 'High' : 'Medium', entityType: 'Distributor × SKU',
      entity: `${m.skus.name[r.sku]} @ ${m.distributors.name[r.dist]}`, context: distCtx(r.dist), metric: `0 units; sells ${fmtL(r.salesValue3m / 3)}/month`,
      impact: r.salesValue3m / 3, action: 'Raise an urgent primary order / inter-distributor transfer.', drill: { level: 'distributor', k: r.dist, name: m.distributors.name[r.dist] } })
    else if (r.status === 'Low Stock' && r.salesValue3m / 3 > 40000) add({
      category: 'Stock', rule: 'Low stock (< 7 days) on a fast mover', severity: 'Medium', entityType: 'Distributor × SKU',
      entity: `${m.skus.name[r.sku]} @ ${m.distributors.name[r.dist]}`, context: distCtx(r.dist), metric: `${r.dos.toFixed(0)} days cover`,
      impact: r.salesValue3m / 3, action: 'Replenish in the next primary cycle.', drill: { level: 'distributor', k: r.dist, name: m.distributors.name[r.dist] } })
  }
  const vals = [...byDist.values()]
  const medV = median(vals.map(v => v.value)), medS = median(vals.map(v => v.sales))
  for (const [d, x] of byDist) {
    if (x.excess > 150000) add({ category: 'Stock', rule: 'Excess stock (> 90 days cover)', severity: x.excess > 600000 ? 'High' : 'Medium', entityType: 'Distributor', entity: m.distributors.name[d],
      context: distCtx(d), metric: `${fmtL(x.excess)} above 90 days cover`, impact: x.excess, action: 'Stop primary on these SKUs; run liquidation / consumer offers.', drill: { level: 'distributor', k: d, name: m.distributors.name[d] } })
    if (x.value > medV && x.sales < medS) add({ category: 'Stock', rule: 'High stock + low sales', severity: 'High', entityType: 'Distributor', entity: m.distributors.name[d],
      context: distCtx(d), metric: `Stock ${fmtL(x.value)} vs 3m sales ${fmtL(x.sales)} (${Math.round(x.value / (x.cogs || 1))} days)`, impact: x.value - x.cogs * 30,
      action: 'Pipeline is over-loaded — freeze primary, redeploy stock, fix secondary execution.', drill: { level: 'distributor', k: d, name: m.distributors.name[d] } })
  }
  for (const [s, y] of bySku) {
    const cover = y.cogs > 0 ? y.value / y.cogs : Infinity
    if (cover > RULES.slowDays && y.value > 100000) add({ category: 'Stock', rule: 'Slow-moving SKU (network cover > 90 days)', severity: cover > 180 ? 'High' : 'Medium', entityType: 'SKU',
      entity: m.skus.name[s], context: `${m.brands.name[ds.skuBrand[s]]} · ${m.skus.status[s]}`, metric: Number.isFinite(cover) ? `${cover.toFixed(0)} days of stock across distributors` : 'No sales in 3 months',
      impact: y.value, action: m.skus.status[s] === 'Discontinued' ? 'Delisted SKU — liquidate and write off.' : 'Reduce pack push; bundle with fast movers; review MOQ.' })
  }

  // ---------------------------------------------------------------- COLLECTIONS
  const col = collectionStats(ds, sc, f.from, f.to, 'distributor')
  for (let d = 0; d < ds.counts.distributor; d++) {
    if (!sc.primaryDistOK[d]) continue
    const od = col.overdue[d], lim = m.distributors.creditLimit[d]
    const ceiV = cei(col.opening[d], col.invoiced[d], col.outstanding[d])
    const drill = { level: 'distributor' as const, k: d, name: m.distributors.name[d] }
    if (od > 0 && (od / lim) * 100 > RULES.overduePctOfLimit) add({ category: 'Collection', rule: 'High overdue amount (> 25% of credit limit)', severity: od > lim ? 'High' : 'Medium', entityType: 'Distributor',
      entity: m.distributors.name[d], context: distCtx(d), metric: `${fmtL(od)} overdue · ${Math.round((od / lim) * 100)}% of limit`, impact: od, action: 'Collection call + stop supply beyond credit limit.', drill })
    if (col.maxOverdueDays[d] > RULES.overdueDays) add({ category: 'Collection', rule: 'High overdue days (> 60 days)', severity: col.maxOverdueDays[d] > 90 ? 'High' : 'Medium', entityType: 'Distributor',
      entity: m.distributors.name[d], context: distCtx(d), metric: `Oldest invoice ${col.maxOverdueDays[d]} days past due`, impact: col.ageing[3][d] + col.ageing[4][d], action: 'Escalate to regional finance; consider credit hold.', drill })
    if (col.invoiced[d] > 0 && ceiV < RULES.ceiLow) add({ category: 'Collection', rule: 'Low collection efficiency (< 75%)', severity: ceiV < 60 ? 'High' : 'Medium', entityType: 'Distributor',
      entity: m.distributors.name[d], context: distCtx(d), metric: `CEI ${ceiV.toFixed(0)}%`, impact: col.outstanding[d], action: 'Agree a payment schedule; move to advance / PDC terms.', drill })
  }

  // ---------------------------------------------------------------- OPPORTUNITIES
  const skus = perfByDim(ds, sc, f, 'sku')
  const totalSales = skus.reduce((a, r) => a + r.sales, 0)
  for (const r of skus) if (r.growth > RULES.skuGrowth && r.sales > totalSales * 0.002) add({ category: 'Opportunity', rule: 'High-growth SKU (> 25% vs LY)', severity: r.growth > 60 ? 'High' : 'Medium', entityType: 'SKU',
    entity: r.name, context: r.context, metric: `${r.growth > 0 ? '+' : ''}${r.growth.toFixed(0)}% · ${fmtL(r.sales)}`, impact: r.change, action: 'Widen distribution to distributors not yet stocking it; secure supply.' })
  const tot = aggregate(ds, sc, { from: f.from, to: f.to, types: 'net_secondary' })
  const pp2 = f.from - 12 >= 0 ? aggregate(ds, sc, { from: f.from - 12, to: f.to - 12, types: 'net_secondary' }) : null
  const coG = pp2 ? growth(tot.net[0], pp2.net[0]) : NaN
  for (const r of perfByDim(ds, sc, f, 'state')) if (!Number.isNaN(coG) && r.growth > coG + RULES.regionGrowthPremium && r.ach >= 100) add({ category: 'Opportunity', rule: 'High-demand state (growth > company + 5 pts, ach ≥ 100%)', severity: 'Medium', entityType: 'State',
    entity: r.name, context: r.context, metric: `+${r.growth.toFixed(0)}% vs company +${coG.toFixed(0)}% · ach ${r.ach.toFixed(0)}%`, impact: r.change, action: 'Add distributors / beats to capture demand; raise next year targets.', drill: { level: 'state', k: r.k, name: r.name } })
  for (const r of sps) if (r.ach > RULES.spTopAch && spProd[r.k] >= 60) add({ category: 'Opportunity', rule: 'High-productivity salesperson', severity: 'Low', entityType: 'Salesperson',
    entity: r.name, context: r.context, metric: `Ach ${r.ach.toFixed(0)}% · productivity ${spProd[r.k].toFixed(0)}%`, impact: r.variance, action: 'Recognise; use as trainer for weak beats; consider bigger territory.', drill: { level: 'salesperson', k: r.k, name: r.name } })
  for (const r of dists) {
    const x = byDist.get(r.k)
    if (!x) continue
    const cover = x.cogs > 0 ? x.value / x.cogs : Infinity
    if (r.growth > RULES.strongSecGrowth && (cover < RULES.thinCover || x.outs >= 3)) add({ category: 'Opportunity', rule: 'Strong secondary but low stock', severity: 'High', entityType: 'Distributor',
      entity: r.name, context: r.context, metric: `+${r.growth.toFixed(0)}% growth · ${cover.toFixed(0)} days cover · ${x.outs} stock-outs`, impact: x.atRisk * 3 + r.secNet * 0.05,
      action: 'Raise stock norms and credit limit; prioritise supply to protect growth.', drill: { level: 'distributor', k: r.k, name: r.name } })
  }
  if (M >= 5) {
    const recent = outletStats(ds, sc, M - 2, M, 'outlet'), before = outletStats(ds, sc, M - 5, M - 3, 'outlet')
    const cand: { o: number; up: number }[] = []
    for (let o = 0; o < ds.counts.outlet; o++) if (recent.orders[o] >= RULES.freqMinOrders && recent.orders[o] >= before.orders[o] * RULES.freqUplift) cand.push({ o, up: recent.orders[o] - before.orders[o] })
    cand.sort((a, b) => b.up - a.up)
    for (const { o } of cand.slice(0, 40)) add({ category: 'Opportunity', rule: 'Outlet with increasing purchase frequency', severity: 'Low', entityType: 'Outlet',
      entity: m.outlets.name[o], context: `${m.outletTypes[ds.outletType[o]]} · ${m.beats.name[ds.outletBeat[o]]}`, metric: `${recent.orders[o]} orders in last 3 months vs ${before.orders[o]} before`,
      impact: recent.net[o] - before.net[o], action: 'Upgrade outlet class, extend range (more lines per call), offer display scheme.', drill: { level: 'outlet', k: o, name: m.outlets.name[o] } })
  }
  return out
}

function median(a: number[]) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
function fmtL(v: number) {
  const a = Math.abs(v)
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
