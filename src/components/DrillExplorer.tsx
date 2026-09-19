import { useMemo, useState } from 'react'
import { ChevronRight, Home, TrendingDown, TrendingUp } from 'lucide-react'
import type { Dataset } from '../data/types'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { priorPeriod, type Filters } from '../state/filters'
import { buildScope, type Dim, type Scope } from '../analytics/engine'
import { perfByDim, type PerfRow } from '../analytics/views'
import { RankBars } from '../charts/Charts'
import { useChartTheme } from '../charts/theme'
import { DataTable } from './DataTable'
import { Badge, achTone, cx, Note } from './ui'
import { inr, num, pctf, signedPct } from '../utils/format'

export type DrillLevel = 'region' | 'state' | 'distributor' | 'salesperson' | 'beat' | 'outlet' | 'sku'
export const DRILL_PATH: DrillLevel[] = ['region', 'state', 'distributor', 'salesperson', 'beat', 'outlet', 'sku']
const LABEL: Record<DrillLevel, string> = { region: 'Region', state: 'State', distributor: 'Distributor', salesperson: 'Salesperson', beat: 'Beat', outlet: 'Outlet', sku: 'SKU' }

export interface DrillStep { level: DrillLevel; k: number; name: string }

/** Global filters + drill path -> scope. Outlet is not a global filter, so it narrows the outlet mask directly. */
export function drillScope(ds: Dataset, f: Filters, path: DrillStep[]): Scope {
  const f2: Filters = { ...f }
  let outlet = -1
  for (const s of path) {
    if (s.level === 'outlet') outlet = s.k
    else if (s.level !== 'sku') f2[s.level] = [s.k]
    else f2.sku = [s.k]
  }
  const sc = buildScope(ds, f2)
  if (outlet >= 0) {
    const ok = sc.outletOK[outlet]
    sc.outletOK = new Uint8Array(sc.outletOK.length)
    sc.outletOK[outlet] = ok
    sc.primaryDistOK = new Uint8Array(sc.primaryDistOK.length)
    sc.outletLevel = true
    sc.targetAvailable = false
  }
  return sc
}

export function DrillExplorer({ initialPath = [], startLabel = 'All India', title }: { initialPath?: DrillStep[]; startLabel?: string; title?: string }) {
  const ds = useData()
  const { filters: f } = useFilters()
  const t = useChartTheme()
  const [path, setPath] = useState<DrillStep[]>(initialPath)
  const sig = JSON.stringify(initialPath)
  const [key, setKey] = useState(sig)
  if (key !== sig) { setKey(sig); setPath(initialPath) } // reset when the caller changes the starting point
  const base = initialPath.length
  const levelIdx = path.length ? DRILL_PATH.indexOf(path[path.length - 1].level) + 1 : 0
  const level = DRILL_PATH[Math.min(levelIdx, DRILL_PATH.length - 1)]
  const atLeaf = levelIdx >= DRILL_PATH.length
  const pp = priorPeriod(f)

  const rows = useMemo(() => {
    const sc = drillScope(ds, f, path)
    return perfByDim(ds, sc, f, level as Dim)
  }, [ds, f, path, level])

  const total = rows.reduce((a, r) => a + r.sales, 0)
  const totalPrior = rows.reduce((a, r) => a + (Number.isNaN(r.prior) ? 0 : r.prior), 0)
  const totalChange = total - totalPrior
  const byChange = [...rows].sort((a, b) => a.change - b.change)
  const drags = byChange.filter(r => r.change < 0).slice(0, 3)
  const lifts = byChange.filter(r => r.change > 0).reverse().slice(0, 3)
  const chartRows = (totalChange < 0 ? byChange : [...byChange].reverse()).slice(0, 12)

  const drill = (r: PerfRow) => { if (!atLeaf) setPath(p => [...p, { level, k: r.k, name: r.name }]) }

  return (
    <div>
      {title && <h3 className="mb-2 text-[13.5px] font-semibold text-ink">{title}</h3>}
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        <button onClick={() => setPath(initialPath.slice(0, base))} className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1', path.length === base ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-2 hover:bg-surface-2')}>
          <Home size={12} />{base ? initialPath[base - 1].name : startLabel}
        </button>
        {path.slice(base).map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <ChevronRight size={12} className="text-muted" />
            <button onClick={() => setPath(path.slice(0, base + i + 1))} className={cx('rounded-md px-2 py-1', i === path.length - base - 1 ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-2 hover:bg-surface-2')}>
              <span className="text-muted">{LABEL[s.level]}:</span> {s.name}
            </button>
          </span>
        ))}
        {!atLeaf && <span className="ml-1 inline-flex items-center gap-1 text-muted"><ChevronRight size={12} />{LABEL[level]}s</span>}
      </nav>

      {!pp ? <Note>Select a period after Jan 2022 to compare against the same period last year.</Note> : (
        <div className="mb-3 grid gap-2 text-xs md:grid-cols-3">
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-muted">Sales at this level</p>
            <p className="mt-0.5 text-lg font-semibold text-ink">{inr(total)}</p>
            <p className={cx('font-medium', totalChange >= 0 ? 'text-good' : 'text-critical')}>{totalChange >= 0 ? '+' : ''}{inr(totalChange)} vs LY ({signedPct(totalPrior ? (totalChange / totalPrior) * 100 : NaN)})</p>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="flex items-center gap-1 text-muted"><TrendingDown size={13} className="text-critical" />Biggest drags</p>
            {drags.length ? drags.map(r => <p key={r.k} className="mt-0.5 truncate text-ink"><span className="text-critical tabular">{inr(r.change)}</span> {r.name}</p>) : <p className="mt-0.5 text-muted">None — every {LABEL[level].toLowerCase()} grew</p>}
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="flex items-center gap-1 text-muted"><TrendingUp size={13} className="text-good" />Biggest lifts</p>
            {lifts.length ? lifts.map(r => <p key={r.k} className="mt-0.5 truncate text-ink"><span className="text-good tabular">+{inr(r.change)}</span> {r.name}</p>) : <p className="mt-0.5 text-muted">None</p>}
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <p className="mb-1 text-xs font-medium text-ink-2">Change vs last year by {LABEL[level].toLowerCase()} {atLeaf ? '' : '(click to drill down)'}</p>
          <RankBars data={chartRows.map(r => ({ name: r.name, value: r.change, id: r.k, sub: `${inr(r.sales)} now · ${signedPct(r.growth)}`, color: r.change >= 0 ? t.series[0] : t.series[7] }))}
            onClick={atLeaf ? undefined : rr => { const r = rows.find(x => x.k === rr.id); if (r) drill(r) }} labelWidth={150} />
        </div>
        <div className="min-w-0 xl:col-span-3">
          <DataTable rows={rows} initialSort="change" initialDir="asc" pageSize={10} dense onRowClick={atLeaf ? undefined : drill} exportName={`drill-${level}`}
            rowClass={r => (r.growth < -10 ? 'bg-critical-bg/40' : undefined)}
            columns={[
              { key: 'name', header: LABEL[level], value: r => r.name, render: r => <div className="max-w-[220px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{r.code || r.context}</p></div> },
              { key: 'sales', header: 'Sales', align: 'right', value: r => r.sales, render: r => inr(r.sales) },
              { key: 'prior', header: 'LY', align: 'right', value: r => r.prior, render: r => inr(r.prior) },
              { key: 'change', header: 'Change', align: 'right', value: r => r.change, render: r => <span className={r.change >= 0 ? 'text-good' : 'text-critical'}>{inr(r.change)}</span> },
              { key: 'growth', header: 'Growth', align: 'right', value: r => r.growth, render: r => signedPct(r.growth) },
              { key: 'share', header: 'Share of Δ', align: 'right', value: r => (totalChange ? (r.change / Math.abs(totalChange)) * 100 : NaN), render: r => pctf(totalChange ? (r.change / Math.abs(totalChange)) * 100 : NaN, 0) },
              { key: 'ach', header: 'Ach %', align: 'right', value: r => r.ach, render: r => (Number.isNaN(r.ach) ? '—' : <Badge tone={achTone(r.ach)}>{pctf(r.ach)}</Badge>) },
              { key: 'qty', header: 'Units', align: 'right', value: r => r.qty, render: r => num(r.qty) },
            ]} />
        </div>
      </div>
    </div>
  )
}
