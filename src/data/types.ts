// ---------------------------------------------------------------------------
// Raw payload shapes (as published by data/build_dataset.py)
// ---------------------------------------------------------------------------
export type ColType = 'u8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32'

export interface BundleLayout {
  file: string
  byteLength: number
  n?: number
  monthStart?: number[]
  dims?: Record<string, number>
  columns: { name: string; type: ColType; offset: number; length: number }[]
}

export interface Manifest {
  version: number
  generatedAt: string
  company: string
  currency: string
  startDate: string
  endDate: string
  asOfDate: string
  months: string[]
  pricePeriods: string[]
  rawRowCounts: Record<string, number>
  bundles: { sales: BundleLayout; stock: BundleLayout; targets: BundleLayout; collections: BundleLayout }
}

export interface Masters {
  regions: string[]
  states: { name: string[]; code: string[]; region: number[] }
  territories: { id: string[]; name: string[]; state: number[] }
  distributors: {
    id: string[]; name: string[]; type: string[]; status: string[]; territory: number[]; city: string[]
    creditLimit: number[]; creditDays: number[]; salesTarget: number[]; joinDate: string[]
  }
  salespersons: { id: string[]; name: string[]; dist: number[]; joinDate: string[]; status: string[] }
  beats: { id: string[]; name: string[]; sp: number[]; visitDay: string[] }
  outletTypes: string[]
  outlets: {
    id: string[]; name: string[]; type: number[]; beat: number[]; city: string[]; status: string[]
    openDate: string[]; closedDate: string[]
  }
  categories: string[]
  brands: { name: string[]; cat: number[] }
  subCategories: { name: string[]; cat: number[] }
  skus: {
    id: string[]; code: string[]; name: string[]; brand: number[]; sub: number[]; cat: number[]; pack: string[]
    status: string[]; launchDate: string[]; gst: number[]; caseSize: number[]
    mrp: number[][]; ptr: number[][]; ptd: number[][]; cogs: number[][]
  }
}

export interface DQCheck {
  id: string; table: string; check: string; rule: string; severity: 'High' | 'Medium' | 'Low'
  count: number; pct: number; action: string; status: 'Pass' | 'Warn' | 'Fail'
  sample: Record<string, string>[]
}
export interface DQReport {
  generatedAt: string; totalRecords: number; validRecords: number; exceptionRecords: number; dqPct: number
  tables: { table: string; total: number; exceptions: number; valid: number; removed?: number; dqPct: number }[]
  checks: DQCheck[]
  reconciliation: { rows: number; raw_net: number; recomputed_net: number; max_abs_diff: number; rows_diff_gt_1: number }
}

// ---------------------------------------------------------------------------
// In-memory analytical model (what the dashboard works with)
// ---------------------------------------------------------------------------
/** Sales type codes stored in the fact table. */
export const PRIMARY = 0
export const SECONDARY = 1
export const RETURN = 2
export const NO_OUTLET = 65535

export interface SalesFact {
  n: number
  day: Uint16Array      // days since 2021-01-01
  month: Uint8Array     // 0..59 (derived)
  stype: Uint8Array     // 0 primary, 1 secondary, 2 sales return
  dist: Uint8Array
  outlet: Uint16Array   // 65535 on primary lines
  sku: Uint16Array
  qty: Int32Array       // negative on returns
  disc: Uint8Array      // trade discount in 0.25% steps
  gross: Float32Array   // derived: qty x unit price of the price period
  net: Float32Array     // derived: gross x (1 - discount)
  cost: Float32Array    // derived: qty x standard cost
  monthStart: number[]  // row offset of each month (rows are sorted by day) -> O(1) date slicing
}

export interface StockFact {
  n: number
  month: Uint8Array; dist: Uint8Array; sku: Uint16Array
  closing: Uint32Array; age0: Uint32Array; age1: Uint32Array; age2: Uint32Array
  monthStart: number[]
}

export interface CollectionFact {
  n: number
  dist: Uint8Array; invDay: Uint16Array; dueDay: Uint16Array; amount: Float32Array
  pay1Day: Uint16Array; pay1Amt: Float32Array; pay2Day: Uint16Array; pay2Amt: Float32Array
}

export interface Dataset {
  manifest: Manifest
  m: Masters
  months: string[]          // 'YYYY-MM'
  monthStartDay: number[]   // day index of the 1st of each month (length 61)
  counts: { region: number; state: number; territory: number; distributor: number; salesperson: number; beat: number; outlet: number; outletType: number; category: number; brand: number; subCategory: number; sku: number }
  // hierarchy lookups (index -> parent index)
  stateRegion: Int32Array
  terrState: Int32Array
  distTerr: Int32Array; distState: Int32Array; distRegion: Int32Array
  spDist: Int32Array
  beatSp: Int32Array; beatDist: Int32Array
  outletBeat: Int32Array; outletSp: Int32Array; outletDist: Int32Array; outletType: Int32Array
  outletOpenMonth: Int32Array; outletCloseMonth: Int32Array // close = first month closed (60 = open)
  skuCat: Int32Array; skuBrand: Int32Array; skuSub: Int32Array
  // price lists [sku * 6 + pricePeriod]
  ptr: Float64Array; ptd: Float64Array; cogs: Float64Array; mrp: Float64Array
  monthPricePeriod: Int32Array
  sales: SalesFact
  stock: StockFact
  targets: { t: Float32Array; mix: Float32Array; nSp: number; nMonths: number; nCat: number; nSku: number }
  coll: CollectionFact
}
