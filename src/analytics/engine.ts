/**
 * Analytical engine - the "semantic model" of the dashboard.
 *
 * Every KPI in the UI is computed here from the transaction-level fact table.
 * Design (Power BI-style, but in TypeScript):
 *   1. `buildScope()` turns the global filters into boolean lookup masks per
 *      dimension member (SKU, distributor, outlet, salesperson). This is done once
 *      per filter change and costs < 2 ms.
 *   2. Aggregations scan only the rows of the selected months (rows are sorted by
 *      date, so a period is a contiguous slice) and test each row with O(1) mask
 *      lookups. A full-year scan of ~220k rows takes a few milliseconds.
 *   3. Group-by uses integer keys resolved through parent lookup arrays
 *      (outlet -> beat -> salesperson -> distributor -> territory -> state -> region).
 */
import type { Dataset } from '../data/types'
import { NO_OUTLET } from '../data/types'
import { BASIS_TYPES, type Basis, type Filters } from '../state/filters'

export type Dim =
  | 'total' | 'month' | 'stype' | 'region' | 'state' | 'territory' | 'distributor' | 'salesperson' | 'beat'
  | 'outlet' | 'outletType' | 'category' | 'brand' | 'subCategory' | 'sku'

/** Dimensions resolvable on primary (distributor-level) rows. */
export const DISTRIBUTOR_LEVEL: Dim[] = ['total', 'month', 'stype', 'region', 'state', 'territory', 'distributor', 'category', 'brand', 'subCategory', 'sku']

export interface Scope {
  f: Filters
  skuOK: Uint8Array
  distOK: Uint8Array        // geography + distributor filters
  primaryDistOK: Uint8Array // distributors whose primary rows are in scope
  spOK: Uint8Array
  outletOK: Uint8Array      // indexed by outlet (length 65536, NO_OUTLET -> 0)
  catOK: Uint8Array
  /** beat / outlet-type filters are below target grain -> targets unavailable */
  targetAvailable: boolean
  /** brand / SKU filters -> targets disaggregated with the SKU plan mix */
  skuLevel: boolean
  /** salesperson / beat / outlet-type filters do not apply to primary (distributor-level) sales */
  outletLevel: boolean
}

const inSet = (arr: number[]) => {
  if (!arr.length) return null
  const s = new Set(arr)
  return (x: number) => s.has(x)
}

export function buildScope(ds: Dataset, f: Filters): Scope {
  const c = ds.counts
  const fCat = inSet(f.category), fBrand = inSet(f.brand), fSku = inSet(f.sku)
  const skuOK = new Uint8Array(c.sku)
  for (let s = 0; s < c.sku; s++) {
    skuOK[s] = (!fCat || fCat(ds.skuCat[s])) && (!fBrand || fBrand(ds.skuBrand[s])) && (!fSku || fSku(s)) ? 1 : 0
  }
  const catOK = new Uint8Array(c.category)
  for (let k = 0; k < c.category; k++) catOK[k] = !fCat || fCat(k) ? 1 : 0

  const fReg = inSet(f.region), fSt = inSet(f.state), fTer = inSet(f.territory), fDist = inSet(f.distributor)
  const distOK = new Uint8Array(c.distributor)
  for (let d = 0; d < c.distributor; d++) {
    distOK[d] = (!fReg || fReg(ds.distRegion[d])) && (!fSt || fSt(ds.distState[d])) && (!fTer || fTer(ds.distTerr[d])) && (!fDist || fDist(d)) ? 1 : 0
  }
  const fSp = inSet(f.salesperson)
  const spOK = new Uint8Array(c.salesperson)
  for (let s = 0; s < c.salesperson; s++) spOK[s] = distOK[ds.spDist[s]] && (!fSp || fSp(s)) ? 1 : 0
  const fBeat = inSet(f.beat), fOT = inSet(f.outletType)
  const outletOK = new Uint8Array(NO_OUTLET + 1)
  const outletLevel = !!(fSp || fBeat || fOT)
  const primaryDistOK = outletLevel ? new Uint8Array(c.distributor) : distOK
  for (let o = 0; o < c.outlet; o++) {
    const ok = spOK[ds.outletSp[o]] && (!fBeat || fBeat(ds.outletBeat[o])) && (!fOT || fOT(ds.outletType[o]))
    if (ok) {
      outletOK[o] = 1
      if (outletLevel) primaryDistOK[ds.outletDist[o]] = 1
    }
  }
  return {
    f, skuOK, distOK, primaryDistOK, spOK, outletOK, catOK,
    targetAvailable: !(fBeat || fOT), skuLevel: !!(fBrand || fSku), outletLevel,
  }
}

/** Return an (n, key(rowIndex)) resolver for a dimension. Key < 0 = row not attributable. */
export function dimResolver(ds: Dataset, dim: Dim): { n: number; key: (i: number) => number } {
  const s = ds.sales
  const c = ds.counts
  const viaOutlet = (arr: Int32Array) => (i: number) => { const o = s.outlet[i]; return o === NO_OUTLET ? -1 : arr[o] }
  switch (dim) {
    case 'total': return { n: 1, key: () => 0 }
    case 'month': return { n: ds.months.length, key: i => s.month[i] }
    case 'stype': return { n: 3, key: i => s.stype[i] }
    case 'region': return { n: c.region, key: i => ds.distRegion[s.dist[i]] }
    case 'state': return { n: c.state, key: i => ds.distState[s.dist[i]] }
    case 'territory': return { n: c.territory, key: i => ds.distTerr[s.dist[i]] }
    case 'distributor': return { n: c.distributor, key: i => s.dist[i] }
    case 'salesperson': return { n: c.salesperson, key: viaOutlet(ds.outletSp) }
    case 'beat': return { n: c.beat, key: viaOutlet(ds.outletBeat) }
    case 'outletType': return { n: c.outletType, key: viaOutlet(ds.outletType) }
    case 'outlet': return { n: c.outlet, key: i => { const o = s.outlet[i]; return o === NO_OUTLET ? -1 : o } }
    case 'category': return { n: c.category, key: i => ds.skuCat[s.sku[i]] }
    case 'brand': return { n: c.brand, key: i => ds.skuBrand[s.sku[i]] }
    case 'subCategory': return { n: c.subCategory, key: i => ds.skuSub[s.sku[i]] }
    case 'sku': return { n: c.sku, key: i => s.sku[i] }
  }
}

export interface Agg {
  n: number
  net: Float64Array; gross: Float64Array; qty: Float64Array; cost: Float64Array; lines: Float64Array
}
const newAgg = (n: number): Agg => ({ n, net: new Float64Array(n), gross: new Float64Array(n), qty: new Float64Array(n), cost: new Float64Array(n), lines: new Float64Array(n) })

export interface AggOpts {
  from: number
  to: number
  /** sales basis or explicit [primary, secondary, return] include flags */
  types: Basis | [boolean, boolean, boolean]
  by?: Dim
  /** optional second dimension -> key = k1 * n2 + k2 */
  by2?: Dim
}

/** Column + lookup map used by the fast scan loop (no per-row closures). */
interface ColKey { n: number; col: 'none' | 'month' | 'stype' | 'dist' | 'outlet' | 'sku'; map: Int32Array | null }
const outletMaps = new WeakMap<Dataset, Record<string, Int32Array>>()
function outletMap(ds: Dataset, name: 'sp' | 'beat' | 'type' | 'id'): Int32Array {
  let cache = outletMaps.get(ds)
  if (!cache) { cache = {}; outletMaps.set(ds, cache) }
  if (!cache[name]) {
    const m = new Int32Array(NO_OUTLET + 1).fill(-1)
    const src = name === 'sp' ? ds.outletSp : name === 'beat' ? ds.outletBeat : name === 'type' ? ds.outletType : null
    for (let o = 0; o < ds.counts.outlet; o++) m[o] = src ? src[o] : o
    cache[name] = m
  }
  return cache[name]
}
function colKey(ds: Dataset, dim: Dim): ColKey {
  const c = ds.counts
  switch (dim) {
    case 'total': return { n: 1, col: 'none', map: null }
    case 'month': return { n: ds.months.length, col: 'month', map: null }
    case 'stype': return { n: 3, col: 'stype', map: null }
    case 'region': return { n: c.region, col: 'dist', map: ds.distRegion }
    case 'state': return { n: c.state, col: 'dist', map: ds.distState }
    case 'territory': return { n: c.territory, col: 'dist', map: ds.distTerr }
    case 'distributor': return { n: c.distributor, col: 'dist', map: null }
    case 'salesperson': return { n: c.salesperson, col: 'outlet', map: outletMap(ds, 'sp') }
    case 'beat': return { n: c.beat, col: 'outlet', map: outletMap(ds, 'beat') }
    case 'outletType': return { n: c.outletType, col: 'outlet', map: outletMap(ds, 'type') }
    case 'outlet': return { n: c.outlet, col: 'outlet', map: outletMap(ds, 'id') }
    case 'category': return { n: c.category, col: 'sku', map: ds.skuCat }
    case 'brand': return { n: c.brand, col: 'sku', map: ds.skuBrand }
    case 'subCategory': return { n: c.subCategory, col: 'sku', map: ds.skuSub }
    case 'sku': return { n: c.sku, col: 'sku', map: null }
  }
}

/** Aggregates split by sales type: arrays are [(k1 * n2 + k2) * 3 + stype]. */
interface AggByType { n: number; n2: number; net: Float64Array; gross: Float64Array; qty: Float64Array; cost: Float64Array; lines: Float64Array }

// Results are cached per filter state (the Scope object is recreated on every filter change).
const aggCache = new WeakMap<Scope, Map<string, AggByType>>()

// Dimensions that are functions of (distributor, SKU) or of outlet can be rolled up from a small
// base matrix instead of re-scanning ~1M rows for every view.
const DIST_SKU_DIMS = new Set<Dim>(['total', 'region', 'state', 'territory', 'distributor', 'category', 'brand', 'subCategory', 'sku'])
const OUTLET_DIMS = new Set<Dim>(['salesperson', 'beat', 'outletType', 'outlet'])

function distSkuKey(ds: Dataset, dim: Dim): (d: number, s: number) => number {
  switch (dim) {
    case 'region': return d => ds.distRegion[d]
    case 'state': return d => ds.distState[d]
    case 'territory': return d => ds.distTerr[d]
    case 'distributor': return d => d
    case 'category': return (_, s) => ds.skuCat[s]
    case 'brand': return (_, s) => ds.skuBrand[s]
    case 'subCategory': return (_, s) => ds.skuSub[s]
    case 'sku': return (_, s) => s
    default: return () => 0
  }
}

function rollup(base: AggByType, nBase: number, n1: number, n2: number, keyOf: (b: number) => number): AggByType {
  const size = n1 * n2 * 3
  const r: AggByType = { n: n1, n2, net: new Float64Array(size), gross: new Float64Array(size), qty: new Float64Array(size), cost: new Float64Array(size), lines: new Float64Array(size) }
  for (let b = 0; b < nBase; b++) {
    const k = keyOf(b)
    if (k < 0) continue
    for (let t = 0; t < 3; t++) {
      const src = b * 3 + t
      if (!base.lines[src]) continue
      const dst = k * 3 + t
      r.net[dst] += base.net[src]; r.gross[dst] += base.gross[src]; r.qty[dst] += base.qty[src]; r.cost[dst] += base.cost[src]; r.lines[dst] += base.lines[src]
    }
  }
  return r
}

function scanByType(ds: Dataset, sc: Scope, from: number, to: number, by: Dim, by2?: Dim): AggByType {
  const baseOnly = by === 'distributor' && by2 === 'sku'
  if (!baseOnly && DIST_SKU_DIMS.has(by) && (!by2 || DIST_SKU_DIMS.has(by2))) {
    const nS = ds.counts.sku
    const base = scanRaw(ds, sc, from, to, 'distributor', 'sku')
    const k1 = distSkuKey(ds, by), n1 = colKey(ds, by).n
    const k2 = by2 ? distSkuKey(ds, by2) : null, n2 = by2 ? colKey(ds, by2).n : 1
    return rollup(base, ds.counts.distributor * nS, n1, n2, b => {
      const d = (b / nS) | 0, s = b - d * nS
      return k2 ? k1(d, s) * n2 + k2(d, s) : k1(d, s)
    })
  }
  if (OUTLET_DIMS.has(by) && !by2 && by !== 'outlet') {
    const base = scanRaw(ds, sc, from, to, 'outlet')
    const map = colKey(ds, by).map!
    return rollup(base, ds.counts.outlet, colKey(ds, by).n, 1, o => map[o])
  }
  return scanRaw(ds, sc, from, to, by, by2)
}

function scanRaw(ds: Dataset, sc: Scope, from: number, to: number, by: Dim, by2?: Dim): AggByType {
  const key = `${from}|${to}|${by}|${by2 ?? ''}`
  let cache = aggCache.get(sc)
  const hit = cache?.get(key)
  if (hit) return hit
  const s = ds.sales
  const k1 = colKey(ds, by), k2 = by2 ? colKey(ds, by2) : null
  const n2 = k2 ? k2.n : 1
  const size = k1.n * n2 * 3
  const r: AggByType = { n: k1.n, n2, net: new Float64Array(size), gross: new Float64Array(size), qty: new Float64Array(size), cost: new Float64Array(size), lines: new Float64Array(size) }
  if (from <= to && from >= 0) {
    const colOf = (c: ColKey['col']) => (c === 'month' ? s.month : c === 'stype' ? s.stype : c === 'dist' ? s.dist : c === 'outlet' ? s.outlet : c === 'sku' ? s.sku : null)
    const c1 = colOf(k1.col), m1 = k1.map, c2 = k2 ? colOf(k2.col) : null, m2 = k2 ? k2.map : null
    const { skuOK, primaryDistOK, outletOK } = sc
    const stype = s.stype, sku = s.sku, dist = s.dist, outlet = s.outlet, net = s.net, gross = s.gross, qty = s.qty, cost = s.cost
    const start = s.monthStart[from], end = s.monthStart[Math.min(to, ds.months.length - 1) + 1]
    for (let i = start; i < end; i++) {
      if (!skuOK[sku[i]]) continue
      const t = stype[i]
      if (t === 0 ? !primaryDistOK[dist[i]] : !outletOK[outlet[i]]) continue
      let k = 0
      if (c1) { const v = c1[i]; k = m1 ? m1[v] : v; if (k < 0) continue }
      if (c2) { const v = c2[i]; const kk = m2 ? m2[v] : v; if (kk < 0) continue; k = k * n2 + kk }
      const idx = k * 3 + t
      r.net[idx] += net[i]; r.gross[idx] += gross[i]; r.qty[idx] += qty[i]; r.cost[idx] += cost[i]; r.lines[idx] += 1
    }
  }
  if (k1.n * n2 <= 60000) {
    if (!cache) { cache = new Map(); aggCache.set(sc, cache) }
    cache.set(key, r)
  }
  return r
}

/** Core scan: sums net / gross / qty / cost / lines by up to two dimensions for the chosen sales types. */
export function aggregate(ds: Dataset, sc: Scope, o: AggOpts): Agg & { n2: number } {
  const types = typeof o.types === 'string' ? BASIS_TYPES[o.types] : o.types
  const r = scanByType(ds, sc, o.from, o.to, o.by ?? 'total', o.by2)
  const n = r.n * r.n2
  const out = newAgg(n)
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < 3; t++) {
      if (!types[t]) continue
      const idx = k * 3 + t
      out.net[k] += r.net[idx]; out.gross[k] += r.gross[idx]; out.qty[k] += r.qty[idx]; out.cost[k] += r.cost[idx]; out.lines[k] += r.lines[idx]
    }
  }
  return { ...out, n: r.n, n2: r.n2 }
}

export const sum = (a: ArrayLike<number>) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t }

// ------------------------------------------------------------------------------------------------
// Targets  (grain: salesperson x month x category; SKU level via plan mix)
// ------------------------------------------------------------------------------------------------
export type TargetDim = 'total' | 'month' | 'region' | 'state' | 'territory' | 'distributor' | 'salesperson' | 'category' | 'brand' | 'subCategory' | 'sku'

/** Target by dimension for the period; null when a filter below target grain (beat / outlet type) is active. */
export function targets(ds: Dataset, sc: Scope, from: number, to: number, by: TargetDim = 'total'): Float64Array | null {
  if (!sc.targetAvailable) return null
  const { t, mix, nMonths, nCat, nSku } = ds.targets
  const c = ds.counts
  const sku = by === 'sku' || by === 'brand' || by === 'subCategory'
  // per (month, category) target of the salespersons in scope
  const tcm = new Float64Array(nMonths * nCat)
  const spKey = (s: number): number => {
    const d = ds.spDist[s]
    switch (by) {
      case 'region': return ds.distRegion[d]
      case 'state': return ds.distState[d]
      case 'territory': return ds.distTerr[d]
      case 'distributor': return d
      case 'salesperson': return s
      default: return 0
    }
  }
  const nOut = by === 'total' ? 1 : by === 'month' ? nMonths : by === 'category' ? c.category : by === 'sku' ? c.sku : by === 'brand' ? c.brand : by === 'subCategory' ? c.subCategory : by === 'region' ? c.region : by === 'state' ? c.state : by === 'territory' ? c.territory : by === 'distributor' ? c.distributor : c.salesperson
  const out = new Float64Array(nOut)
  // category factor per month: share of the category target that belongs to the selected SKUs
  let catFactor: Float64Array | null = null
  if (sc.skuLevel) {
    catFactor = new Float64Array(nMonths * nCat)
    for (let m = from; m <= to; m++) for (let s = 0; s < nSku; s++) if (sc.skuOK[s]) catFactor[m * nCat + ds.skuCat[s]] += mix[m * nSku + s]
  }
  for (let s = 0; s < c.salesperson; s++) {
    if (!sc.spOK[s]) continue
    const key = spKey(s)
    for (let m = from; m <= to; m++) {
      const base = (s * nMonths + m) * nCat
      for (let k = 0; k < nCat; k++) {
        const v = t[base + k]
        if (!v || !sc.catOK[k]) continue
        if (sku) { tcm[m * nCat + k] += v; continue }
        const f = catFactor ? catFactor[m * nCat + k] : 1
        const val = v * f
        if (by === 'month') out[m] += val
        else if (by === 'category') out[k] += val
        else out[key] += val
      }
    }
  }
  if (sku) {
    for (let s = 0; s < nSku; s++) {
      if (!sc.skuOK[s]) continue
      const k = ds.skuCat[s]
      let v = 0
      for (let m = from; m <= to; m++) v += tcm[m * nCat + k] * mix[m * nSku + s]
      out[by === 'sku' ? s : by === 'brand' ? ds.skuBrand[s] : ds.skuSub[s]] += v
    }
  }
  return out
}

// ------------------------------------------------------------------------------------------------
// Outlet productivity (orders, productive outlets, active outlet universe)
// ------------------------------------------------------------------------------------------------
export type OutletDim = 'total' | 'month' | 'region' | 'state' | 'territory' | 'distributor' | 'salesperson' | 'beat' | 'outletType' | 'outlet'

export interface OutletStats {
  n: number
  orders: Float64Array      // distinct secondary invoices
  productive: Float64Array  // distinct outlets billed at least once
  active: Float64Array      // outlet universe (registered & open during the period)
  lines: Float64Array
  net: Float64Array         // secondary net (excl. returns) for AOV
}

function outletKeyFn(ds: Dataset, dim: OutletDim): { n: number; key: (o: number) => number } {
  const c = ds.counts
  switch (dim) {
    case 'total': case 'month': return { n: 1, key: () => 0 }
    case 'region': return { n: c.region, key: o => ds.distRegion[ds.outletDist[o]] }
    case 'state': return { n: c.state, key: o => ds.distState[ds.outletDist[o]] }
    case 'territory': return { n: c.territory, key: o => ds.distTerr[ds.outletDist[o]] }
    case 'distributor': return { n: c.distributor, key: o => ds.outletDist[o] }
    case 'salesperson': return { n: c.salesperson, key: o => ds.outletSp[o] }
    case 'beat': return { n: c.beat, key: o => ds.outletBeat[o] }
    case 'outletType': return { n: c.outletType, key: o => ds.outletType[o] }
    case 'outlet': return { n: c.outlet, key: o => o }
  }
}

export function outletStats(ds: Dataset, sc: Scope, from: number, to: number, dim: OutletDim = 'total'): OutletStats {
  const s = ds.sales
  if (dim === 'month') {
    // month-wise: productive = distinct outlets billed in each month
    const nM = ds.months.length
    const res: OutletStats = { n: nM, orders: new Float64Array(nM), productive: new Float64Array(nM), active: new Float64Array(nM), lines: new Float64Array(nM), net: new Float64Array(nM) }
    for (let m = from; m <= to; m++) {
      const one = outletStats(ds, sc, m, m, 'total')
      res.orders[m] = one.orders[0]; res.productive[m] = one.productive[0]; res.active[m] = one.active[0]; res.lines[m] = one.lines[0]; res.net[m] = one.net[0]
    }
    return res
  }
  const kf = outletKeyFn(ds, dim)
  const res: OutletStats = { n: kf.n, orders: new Float64Array(kf.n), productive: new Float64Array(kf.n), active: new Float64Array(kf.n), lines: new Float64Array(kf.n), net: new Float64Array(kf.n) }
  for (let o = 0; o < ds.counts.outlet; o++) {
    if (!sc.outletOK[o]) continue
    if (ds.outletOpenMonth[o] <= to && ds.outletCloseMonth[o] > from) res.active[kf.key(o)] += 1
  }
  if (from > to) return res
  const seen = new Uint8Array(ds.counts.outlet)
  const start = s.monthStart[from], end = s.monthStart[to + 1]
  let lastDay = -1, lastOutlet = -1
  for (let i = start; i < end; i++) {
    if (s.stype[i] !== 1) continue
    const o = s.outlet[i]
    if (!sc.outletOK[o] || !sc.skuOK[s.sku[i]]) continue
    const k = kf.key(o)
    res.lines[k] += 1
    res.net[k] += s.net[i]
    const d = s.day[i]
    if (d !== lastDay || o !== lastOutlet) { res.orders[k] += 1; lastDay = d; lastOutlet = o }
    if (!seen[o]) { seen[o] = 1; res.productive[k] += 1 }
  }
  return res
}

/** Distinct distributors / SKUs with sales in scope. */
export function distinctCount(ds: Dataset, sc: Scope, from: number, to: number, types: Basis | [boolean, boolean, boolean], what: 'distributor' | 'sku', by?: Dim): Float64Array {
  const s = ds.sales
  const tps = typeof types === 'string' ? BASIS_TYPES[types] : types
  if (DIST_SKU_DIMS.has(by ?? 'total')) {
    // derived from the cached distributor x SKU base matrix
    const nD = ds.counts.distributor, nS = ds.counts.sku
    const base = scanRaw(ds, sc, from, to, 'distributor', 'sku')
    const kf = distSkuKey(ds, by ?? 'total'), n = colKey(ds, by ?? 'total').n
    const nW = what === 'distributor' ? nD : nS
    const seen = new Uint8Array(n * nW), out = new Float64Array(n)
    for (let d = 0; d < nD; d++) for (let k = 0; k < nS; k++) {
      const b = (d * nS + k) * 3
      if (!((tps[0] && base.lines[b]) || (tps[1] && base.lines[b + 1]))) continue
      const key = kf(d, k)
      const idx = key * nW + (what === 'distributor' ? d : k)
      if (!seen[idx]) { seen[idx] = 1; out[key] += 1 }
    }
    return out
  }
  const d1 = dimResolver(ds, by ?? 'total')
  const nW = what === 'distributor' ? ds.counts.distributor : ds.counts.sku
  const seen = new Uint8Array(d1.n * nW)
  const out = new Float64Array(d1.n)
  if (from > to) return out
  for (let i = s.monthStart[from]; i < s.monthStart[to + 1]; i++) {
    const t = s.stype[i]
    if (!tps[t] || t === 2) continue
    if (!sc.skuOK[s.sku[i]]) continue
    if (t === 0 ? !sc.primaryDistOK[s.dist[i]] : !sc.outletOK[s.outlet[i]]) continue
    const k = d1.key(i)
    if (k < 0) continue
    const w = what === 'distributor' ? s.dist[i] : s.sku[i]
    const idx = k * nW + w
    if (!seen[idx]) { seen[idx] = 1; out[k] += 1 }
  }
  return out
}

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------
export const pct = (a: number, b: number) => (b ? (a / b) * 100 : NaN)
export const growth = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : NaN)

export function dimName(ds: Dataset, dim: Dim | TargetDim | OutletDim, k: number): string {
  const m = ds.m
  switch (dim) {
    case 'region': return m.regions[k]
    case 'state': return m.states.name[k]
    case 'territory': return m.territories.name[k]
    case 'distributor': return m.distributors.name[k]
    case 'salesperson': return m.salespersons.name[k]
    case 'beat': return m.beats.name[k]
    case 'outlet': return m.outlets.name[k]
    case 'outletType': return m.outletTypes[k]
    case 'category': return m.categories[k]
    case 'brand': return m.brands.name[k]
    case 'subCategory': return m.subCategories.name[k]
    case 'sku': return m.skus.name[k]
    case 'month': return ds.months[k]
    case 'stype': return ['Primary', 'Secondary', 'Sales Return'][k]
    default: return 'Total'
  }
}

export function dimCode(ds: Dataset, dim: Dim | TargetDim | OutletDim, k: number): string {
  const m = ds.m
  switch (dim) {
    case 'state': return m.states.code[k]
    case 'territory': return m.territories.id[k]
    case 'distributor': return m.distributors.id[k]
    case 'salesperson': return m.salespersons.id[k]
    case 'beat': return m.beats.id[k]
    case 'outlet': return m.outlets.id[k]
    case 'sku': return m.skus.code[k]
    default: return ''
  }
}

/** Parent path label (e.g. "North › Uttar Pradesh") for context in tables. */
export function dimContext(ds: Dataset, dim: Dim | TargetDim | OutletDim, k: number): string {
  const m = ds.m
  const geo = (d: number) => `${m.states.name[ds.distState[d]]} › ${m.territories.name[ds.distTerr[d]]}`
  switch (dim) {
    case 'state': return m.regions[ds.stateRegion[k]]
    case 'territory': return `${m.regions[ds.stateRegion[ds.terrState[k]]]} › ${m.states.name[ds.terrState[k]]}`
    case 'distributor': return geo(k)
    case 'salesperson': return m.distributors.name[ds.spDist[k]]
    case 'beat': return `${m.salespersons.name[ds.beatSp[k]]} · ${m.distributors.name[ds.beatDist[k]]}`
    case 'outlet': return `${m.outletTypes[ds.outletType[k]]} · ${m.beats.name[ds.outletBeat[k]]}`
    case 'sku': return `${m.brands.name[ds.skuBrand[k]]} · ${m.categories[ds.skuCat[k]]}`
    case 'brand': return m.categories[m.brands.cat[k]]
    case 'subCategory': return m.categories[m.subCategories.cat[k]]
    default: return ''
  }
}
