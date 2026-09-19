const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })

const bad = (v: number) => v == null || Number.isNaN(v) || !Number.isFinite(v)

/** Indian currency in Crore / Lakh notation: ₹12.34 Cr, ₹8.5 L, ₹12,345 */
export function inr(v: number, digits = 2): string {
  if (bad(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(digits)} Cr`
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(digits === 2 ? 1 : digits)} L`
  return `${sign}₹${nf0.format(a)}`
}

/** Short axis ticks: 1.2Cr, 45L, 12K */
export function inrAxis(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e7) return `${sign}${+(a / 1e7).toFixed(1)}Cr`
  if (a >= 1e5) return `${sign}${+(a / 1e5).toFixed(1)}L`
  if (a >= 1e3) return `${sign}${+(a / 1e3).toFixed(0)}K`
  return `${sign}${Math.round(a)}`
}

export const num = (v: number) => (bad(v) ? '—' : nf0.format(v))
export const num1 = (v: number) => (bad(v) ? '—' : nf1.format(v))
export const num2 = (v: number) => (bad(v) ? '—' : nf2.format(v))
export function compact(v: number): string {
  if (bad(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)} L`
  return nf0.format(v)
}
export const pctf = (v: number, d = 1) => (bad(v) ? '—' : `${v.toFixed(d)}%`)
export const signedPct = (v: number, d = 1) => (bad(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
export const days = (v: number) => (bad(v) ? (v === Infinity ? '∞' : '—') : `${Math.round(v)} d`)
