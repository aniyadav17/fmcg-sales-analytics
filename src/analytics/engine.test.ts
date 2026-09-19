/**
 * Reconciliation tests: the in-browser engine must reproduce the totals that the
 * Python ETL computes independently with pandas (data/processed/reference_totals.json).
 * Run with `npm test`.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildDataset, loadDataset, type DataSource } from '../data/loader'
import type { BundleLayout, Dataset } from '../data/types'
import { defaultFilters, type Filters } from '../state/filters'
import { aggregate, buildScope, outletStats, targets } from './engine'
import { perfByDim } from './views'
import { stockSnapshot, summarizeStock, classify } from './stock'
import { collectionStats, cei } from './collections'

const root = resolve(__dirname, '../..')
const WEB = resolve(root, 'public/data')
const ref = JSON.parse(readFileSync(resolve(root, 'data/processed/reference_totals.json'), 'utf8'))

const fsSource: DataSource = {
  loadManifest: async () => JSON.parse(readFileSync(resolve(WEB, 'manifest.json'), 'utf8')),
  loadMasters: async () => JSON.parse(readFileSync(resolve(WEB, 'masters.json'), 'utf8')),
  loadDataQuality: async () => JSON.parse(readFileSync(resolve(WEB, 'data_quality.json'), 'utf8')),
  loadBundle: async (layout: BundleLayout) => {
    const buf = gunzipSync(readFileSync(resolve(WEB, layout.file)))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const C = { u8: Uint8Array, u16: Uint16Array, i16: Int16Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array }
    return Object.fromEntries(layout.columns.map(c => [c.name, new C[c.type](ab, c.offset, c.length)]))
  },
}

let ds: Dataset
const year = (y: number, extra: Partial<Filters> = {}): Filters => ({ ...defaultFilters(), from: (y - 2021) * 12, to: (y - 2021) * 12 + 11, ...extra })
const close = (a: number, b: number, tol = 1e-4) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(tol)

beforeAll(async () => { ds = await loadDataset(fsSource) }, 60_000)

describe('dataset load', () => {
  it('loads ~1M transaction rows sorted by date', () => {
    expect(ds.sales.n).toBeGreaterThan(900_000)
    for (let i = 1; i < ds.sales.n; i += 997) expect(ds.sales.day[i]).toBeGreaterThanOrEqual(ds.sales.day[i - 1])
    expect(ds.sales.monthStart[60]).toBe(ds.sales.n)
  })
  it('buildDataset is exported for API-backed sources', () => expect(typeof buildDataset).toBe('function'))
})

describe('sales reconciliation vs pandas', () => {
  for (const y of [2021, 2022, 2023, 2024, 2025]) {
    it(`net sales by type ${y}`, () => {
      const sc = buildScope(ds, year(y))
      const r = ref.netSalesByYearType[String(y)]
      close(aggregate(ds, sc, { from: (y - 2021) * 12, to: (y - 2021) * 12 + 11, types: 'primary' }).net[0], r.Primary)
      close(aggregate(ds, sc, { from: (y - 2021) * 12, to: (y - 2021) * 12 + 11, types: 'secondary' }).net[0], r.Secondary)
      close(aggregate(ds, sc, { from: (y - 2021) * 12, to: (y - 2021) * 12 + 11, types: 'returns' }).net[0], r['Sales Return'])
    })
  }
  it('net secondary 2025 by region', () => {
    const f = year(2025)
    const rows = perfByDim(ds, buildScope(ds, f), f, 'region')
    for (const r of rows) close(r.secNet, ref.netSecondary2025ByRegion[r.name])
  })
  it('regions add up to the company total (additivity)', () => {
    const f = year(2024)
    const sc = buildScope(ds, f)
    const total = aggregate(ds, sc, { from: f.from, to: f.to, types: 'net_secondary' }).net[0]
    const parts = perfByDim(ds, sc, f, 'state').reduce((a, r) => a + r.sales, 0)
    close(parts, total, 1e-9)
  })
  it('a region filter equals the region slice', () => {
    const f = year(2025)
    const all = perfByDim(ds, buildScope(ds, f), f, 'region').find(r => r.name === 'South')!
    const southIdx = ds.m.regions.indexOf('South')
    const filtered = aggregate(ds, buildScope(ds, { ...f, region: [southIdx] }), { from: f.from, to: f.to, types: 'net_secondary' }).net[0]
    close(filtered, all.sales, 1e-9)
  })
  it('secondary order count matches distinct invoices', () => {
    const f = year(2025)
    expect(outletStats(ds, buildScope(ds, f), f.from, f.to).orders[0]).toBe(ref.secondaryOrders2025)
  })
})

describe('targets, stock and collections', () => {
  for (const y of [2021, 2023, 2025]) {
    it(`target total ${y}`, () => close(targets(ds, buildScope(ds, year(y)), (y - 2021) * 12, (y - 2021) * 12 + 11, 'total')![0], ref.targetByYear[String(y)]))
  }
  it('SKU-level targets disaggregate the category target (plan mix sums to 1)', () => {
    const f = year(2025)
    const sc = buildScope(ds, f)
    const byCat = targets(ds, sc, f.from, f.to, 'category')!
    const bySku = targets(ds, sc, f.from, f.to, 'sku')!
    const cat0 = Array.from(bySku).reduce((a, v, s) => a + (ds.skuCat[s] === 0 ? v : 0), 0)
    close(cat0, byCat[0], 1e-3)
  })
  it('targets are unavailable below salesperson grain', () => expect(targets(ds, buildScope(ds, year(2025, { beat: [0] })), 48, 59)).toBeNull())
  it('stock value and stock-outs at Dec-2025', () => {
    const sc = buildScope(ds, year(2025))
    const rows = stockSnapshot(ds, sc, 59)
    const s = summarizeStock(rows, ds, 59)
    close(s.value, ref.stockValueDec2025, 1e-3)
    expect(s.stockOuts).toBe(ref.stockOutLinesDec2025)
  })
  it('outstanding receivables at Dec-2025', () => close(collectionStats(ds, buildScope(ds, year(2025)), 48, 59).outstanding[0], ref.outstandingDec2025, 1e-3))
  it('CEI formula', () => { expect(cei(100, 900, 200)).toBeCloseTo(80); expect(Number.isNaN(cei(0, 0, 0))).toBe(true) })
  it('stock status rules', () => {
    expect(classify(0, 50).status).toBe('Stock-out')
    expect(classify(10, 0).status).toBe('Non-moving')
    expect(classify(3, 91).status).toBe('Low Stock')      // 3 days
    expect(classify(30, 91).status).toBe('Healthy')       // 30 days
    expect(classify(60, 91).status).toBe('Overstock')     // 60 days
    expect(classify(200, 91).status).toBe('Slow-moving')  // 200 days
  })
})
