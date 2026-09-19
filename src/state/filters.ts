export type Basis = 'net_secondary' | 'secondary' | 'primary' | 'returns'

export const BASIS_LABEL: Record<Basis, string> = {
  net_secondary: 'Secondary (net of returns)',
  secondary: 'Secondary (gross)',
  primary: 'Primary',
  returns: 'Sales returns',
}

/** Which sales-type codes (0 primary, 1 secondary, 2 return) a basis includes. */
export const BASIS_TYPES: Record<Basis, [boolean, boolean, boolean]> = {
  net_secondary: [false, true, true],
  secondary: [false, true, false],
  primary: [true, false, false],
  returns: [false, false, true],
}

export type DimFilterKey =
  | 'region' | 'state' | 'territory' | 'distributor' | 'salesperson' | 'beat' | 'outletType'
  | 'category' | 'brand' | 'sku'

export const DIM_FILTER_KEYS: DimFilterKey[] = ['region', 'state', 'territory', 'distributor', 'salesperson', 'beat', 'outletType', 'category', 'brand', 'sku']

export interface Filters {
  /** inclusive month indices (0 = Jan-2021) */
  from: number
  to: number
  basis: Basis
  region: number[]; state: number[]; territory: number[]; distributor: number[]; salesperson: number[]
  beat: number[]; outletType: number[]; category: number[]; brand: number[]; sku: number[]
}

export const LAST_MONTH = 59

export function defaultFilters(): Filters {
  return {
    from: 48, to: 59, basis: 'net_secondary',
    region: [], state: [], territory: [], distributor: [], salesperson: [], beat: [], outletType: [],
    category: [], brand: [], sku: [],
  }
}

export interface PeriodPreset { id: string; label: string; from: number; to: number }

export function periodPresets(): PeriodPreset[] {
  const out: PeriodPreset[] = []
  for (let y = 2025; y >= 2021; y--) out.push({ id: `cy${y}`, label: `CY ${y}`, from: (y - 2021) * 12, to: (y - 2021) * 12 + 11 })
  out.push({ id: 'fy2526', label: 'FY 2025-26 YTD (Apr-Dec)', from: 51, to: 59 })
  for (let y = 2024; y >= 2021; y--) {
    const from = (y - 2021) * 12 + 3
    out.push({ id: `fy${y}`, label: `FY ${y}-${String(y + 1).slice(2)}`, from, to: from + 11 })
  }
  out.push({ id: 'l3', label: 'Last 3 months', from: 57, to: 59 })
  out.push({ id: 'l6', label: 'Last 6 months', from: 54, to: 59 })
  out.push({ id: 'q4', label: 'Q4 2025 (Oct-Dec)', from: 57, to: 59 })
  out.push({ id: 'all', label: 'All data (2021-2025)', from: 0, to: 59 })
  return out
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthLabel = (m: number) => `${MONTH_NAMES[m % 12]}-${String(21 + Math.floor(m / 12))}`
export const monthLong = (m: number) => `${MONTH_NAMES[m % 12]} ${2021 + Math.floor(m / 12)}`

export function periodLabel(f: Pick<Filters, 'from' | 'to'>) {
  const p = periodPresets().find(x => x.from === f.from && x.to === f.to && x.id !== 'q4')
  if (p) return p.label
  return f.from === f.to ? monthLong(f.from) : `${monthLong(f.from)} - ${monthLong(f.to)}`
}

/** Same period last year (for growth); null when it falls before the data starts. */
export function priorPeriod(f: Pick<Filters, 'from' | 'to'>): { from: number; to: number } | null {
  return f.from - 12 >= 0 ? { from: f.from - 12, to: f.to - 12 } : null
}

export function activeFilterCount(f: Filters) {
  return DIM_FILTER_KEYS.reduce((a, k) => a + (f[k].length ? 1 : 0), 0)
}
