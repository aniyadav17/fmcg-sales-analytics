import type { BundleLayout, ColType, Dataset, DQReport, Manifest, Masters } from './types'

/**
 * Data-access layer.
 *
 * The dashboard only depends on the `DataSource` interface. Today it is served by
 * `StaticFileSource` (pre-built files under /public/data). To move to a live
 * backend, implement the same interface against an API (e.g. SQL Server / Azure
 * Function returning the same columnar arrays or JSON) and pass it to <DataProvider>.
 */
export interface DataSource {
  loadManifest(): Promise<Manifest>
  loadMasters(): Promise<Masters>
  loadBundle(layout: BundleLayout): Promise<Record<string, ArrayLike<number>>>
  loadDataQuality(): Promise<DQReport>
}

type Typed = Uint8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array
const CTOR: Record<ColType, new (b: ArrayBuffer, o: number, l: number) => Typed> = {
  u8: Uint8Array, u16: Uint16Array, i16: Int16Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array,
}

async function gunzipIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, 2)
  // Some static hosts / dev servers already decode .gz transparently - check the magic bytes.
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).arrayBuffer()
}

export class StaticFileSource implements DataSource {
  constructor(private base = './data/') {}

  private async get(path: string): Promise<Response> {
    const res = await fetch(this.base + path)
    if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`)
    return res
  }
  async loadManifest() { return (await this.get('manifest.json')).json() as Promise<Manifest> }
  async loadMasters() { return (await this.get('masters.json')).json() as Promise<Masters> }
  async loadDataQuality() { return (await this.get('data_quality.json')).json() as Promise<DQReport> }
  async loadBundle(layout: BundleLayout) {
    const buf = await gunzipIfNeeded(await (await this.get(layout.file)).arrayBuffer())
    if (buf.byteLength < layout.byteLength) throw new Error(`${layout.file} is truncated`)
    const out: Record<string, Typed> = {}
    for (const c of layout.columns) out[c.name] = new CTOR[c.type](buf, c.offset, c.length)
    return out
  }
}

const monthIndexOf = (iso: string) => (Number(iso.slice(0, 4)) - 2021) * 12 + Number(iso.slice(5, 7)) - 1

/** Load every file and derive the in-memory analytical model. */
export async function loadDataset(src: DataSource, onProgress?: (done: number, total: number, label: string) => void): Promise<Dataset> {
  const total = 6
  let done = 0
  const step = <T,>(p: Promise<T>, label: string) => p.then(v => { onProgress?.(++done, total, label); return v })
  const manifest = await step(src.loadManifest(), 'manifest')
  const [m, salesB, stockB, targetB, collB] = await Promise.all([
    step(src.loadMasters(), 'master data'),
    step(src.loadBundle(manifest.bundles.sales), 'sales transactions'),
    step(src.loadBundle(manifest.bundles.stock), 'distributor stock'),
    step(src.loadBundle(manifest.bundles.targets), 'targets'),
    step(src.loadBundle(manifest.bundles.collections), 'collections'),
  ])
  return buildDataset(manifest, m, salesB, stockB, targetB, collB)
}

function i32(arr: ArrayLike<number>) { return Int32Array.from(arr) }

export function buildDataset(
  manifest: Manifest, m: Masters,
  salesB: Record<string, ArrayLike<number>>, stockB: Record<string, ArrayLike<number>>,
  targetB: Record<string, ArrayLike<number>>, collB: Record<string, ArrayLike<number>>,
): Dataset {
  const nMonths = manifest.months.length
  const t0 = Date.UTC(2021, 0, 1)
  const monthStartDay = Array.from({ length: nMonths + 1 }, (_, i) => Math.round((Date.UTC(2021 + Math.floor(i / 12), i % 12, 1) - t0) / 86400000))
  const monthPricePeriod = Int32Array.from({ length: nMonths }, (_, mo) => (mo < 3 ? 0 : Math.min(5, 1 + Math.floor((mo - 3) / 12))))

  const stateRegion = i32(m.states.region)
  const terrState = i32(m.territories.state)
  const distTerr = i32(m.distributors.territory)
  const distState = distTerr.map(t => terrState[t])
  const distRegion = distState.map(s => stateRegion[s])
  const spDist = i32(m.salespersons.dist)
  const beatSp = i32(m.beats.sp)
  const beatDist = beatSp.map(s => spDist[s])
  const outletBeat = i32(m.outlets.beat)
  const outletSp = outletBeat.map(b => beatSp[b])
  const outletDist = outletSp.map(s => spDist[s])
  const outletType = i32(m.outlets.type)
  const outletOpenMonth = Int32Array.from(m.outlets.openDate, d => Math.max(0, monthIndexOf(d)))
  const outletCloseMonth = Int32Array.from(m.outlets.closedDate, d => (d ? monthIndexOf(d) + 1 : nMonths))

  const nSku = m.skus.id.length
  const flat = (a: number[][]) => Float64Array.from(a.flat())
  const ptr = flat(m.skus.ptr), ptd = flat(m.skus.ptd), cogs = flat(m.skus.cogs), mrp = flat(m.skus.mrp)

  // ---- sales fact + derived money columns ----
  const s = salesB as unknown as { day: Uint16Array; stype: Uint8Array; dist: Uint8Array; outlet: Uint16Array; sku: Uint16Array; qty: Int32Array; disc: Uint8Array }
  const n = s.day.length
  const dayMonth = new Uint8Array(monthStartDay[nMonths] + 1)
  for (let mo = 0; mo < nMonths; mo++) dayMonth.fill(mo, monthStartDay[mo], monthStartDay[mo + 1])
  const month = new Uint8Array(n), gross = new Float32Array(n), net = new Float32Array(n), cost = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const mo = dayMonth[s.day[i]]
    month[i] = mo
    const k = s.sku[i] * 6 + monthPricePeriod[mo]
    const g = s.qty[i] * (s.stype[i] === 0 ? ptd[k] : ptr[k])
    gross[i] = g
    net[i] = g * (1 - s.disc[i] / 400)
    cost[i] = s.qty[i] * cogs[k]
  }
  const sales = { n, ...s, month, gross, net, cost, monthStart: manifest.bundles.sales.monthStart! }

  const st = stockB as unknown as Omit<Dataset['stock'], 'n' | 'monthStart'>
  const stock = { n: st.month.length, ...st, monthStart: manifest.bundles.stock.monthStart! }
  const dims = manifest.bundles.targets.dims!
  const targets = { t: targetB.target as Float32Array, mix: targetB.skuMix as Float32Array, nSp: dims.salespersons, nMonths: dims.months, nCat: dims.categories, nSku: dims.skus }
  const c = collB as unknown as Omit<Dataset['coll'], 'n'>
  const coll = { n: c.dist.length, ...c }

  return {
    manifest, m, months: manifest.months, monthStartDay,
    counts: {
      region: m.regions.length, state: m.states.name.length, territory: m.territories.id.length,
      distributor: m.distributors.id.length, salesperson: m.salespersons.id.length, beat: m.beats.id.length,
      outlet: m.outlets.id.length, outletType: m.outletTypes.length, category: m.categories.length,
      brand: m.brands.name.length, subCategory: m.subCategories.name.length, sku: nSku,
    },
    stateRegion, terrState, distTerr, distState, distRegion, spDist, beatSp, beatDist,
    outletBeat, outletSp, outletDist, outletType, outletOpenMonth, outletCloseMonth,
    skuCat: i32(m.skus.cat), skuBrand: i32(m.skus.brand), skuSub: i32(m.skus.sub),
    ptr, ptd, cogs, mrp, monthPricePeriod, sales, stock, targets, coll,
  }
}
