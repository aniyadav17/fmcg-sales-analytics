import { useMemo, useState } from 'react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { BASIS_LABEL, periodLabel } from '../state/filters'
import { growth, pct } from '../analytics/engine'
import { perfByDim, type PerfRow } from '../analytics/views'
import { Badge, Card, KpiCard, PageHeader, Segmented, achTone, InlineBar, Note } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { DrillExplorer } from '../components/DrillExplorer'
import { RankBars } from '../charts/Charts'
import { useChartTheme } from '../charts/theme'
import { inr, num, pctf, signedPct } from '../utils/format'

type Level = 'region' | 'state' | 'territory' | 'distributor' | 'salesperson'
const LEVELS: { value: Level; label: string }[] = [
  { value: 'region', label: 'Region' }, { value: 'state', label: 'State' }, { value: 'territory', label: 'Territory' },
  { value: 'distributor', label: 'Distributor' }, { value: 'salesperson', label: 'Salesperson' },
]

export default function SalesPerformance() {
  const ds = useData()
  const { filters: f, scope: sc, setDim } = useFilters()
  const t = useChartTheme()
  const [level, setLevel] = useState<Level>('state')

  const rows = useMemo(() => perfByDim(ds, sc, f, level), [ds, sc, f, level])
  const tot = useMemo(() => {
    const s = rows.reduce((a, r) => ({ sales: a.sales + r.sales, prior: a.prior + (r.prior || 0), target: a.target + (r.target || 0), sec: a.sec + r.secNet, qty: a.qty + r.qty, margin: a.margin + r.margin }), { sales: 0, prior: 0, target: 0, sec: 0, qty: 0, margin: 0 })
    return s
  }, [rows])
  const withTarget = rows.filter(r => r.target > 0)
  const ranked = [...withTarget].sort((a, b) => b.ach - a.ach)
  const top = ranked.slice(0, 5), bottom = ranked.slice(-5).reverse()
  const variance = [...withTarget].sort((a, b) => a.variance - b.variance)
  const varRows = variance.length > 16 ? [...variance.slice(0, 8), ...variance.slice(-8)] : variance
  const below80 = withTarget.filter(r => r.ach < 80).length
  const declining = rows.filter(r => r.growth < 0).length
  const ach = pct(tot.sec, tot.target)
  const hasTarget = sc.targetAvailable

  return (
    <div>
      <PageHeader title="Sales Performance" subtitle={`${periodLabel(f)} · ${BASIS_LABEL[f.basis]} · target comparisons use net secondary`}>
        <Segmented value={level} options={LEVELS} onChange={setLevel} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Sales" info="sales" value={inr(tot.sales)} delta={growth(tot.sales, tot.prior)} />
        <KpiCard label="Target" info="target" value={hasTarget ? inr(tot.target) : '—'} sub={hasTarget ? `Variance ${inr(tot.sec - tot.target)}` : 'n/a for beat / outlet-type filter'} />
        <KpiCard label="Achievement %" info="achievement" value={pctf(ach)} tone={achTone(ach)} sub={`${below80} ${level}s below 80%`} />
        <KpiCard label="Growth %" info="growth" value={signedPct(growth(tot.sales, tot.prior))} sub={`${declining} ${level}s declining`} tone={growth(tot.sales, tot.prior) >= 0 ? 'good' : 'critical'} />
        <KpiCard label="Quantity" value={num(tot.qty)} sub="units" />
        <KpiCard label="Gross Margin" info="margin_pct" value={inr(tot.margin)} sub={`${pctf(pct(tot.margin, tot.sales))} of sales`} />
      </div>

      {!hasTarget && <div className="mt-3"><Note tone="warn">Targets are set at salesperson × category grain, so achievement is unavailable while a Beat or Outlet-type filter is applied.</Note></div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Top performers" subtitle={`Highest achievement % by ${level}`} info="achievement">
          <PerformerList rows={top} onPick={r => setDim(level, [r.k])} />
        </Card>
        <Card title="Bottom performers" subtitle={`Lowest achievement % by ${level}`} info="achievement">
          <PerformerList rows={bottom} onPick={r => setDim(level, [r.k])} />
        </Card>
        <Card title="Variance to target" subtitle={variance.length > 16 ? 'Largest shortfalls and over-achievements' : 'Actual − target'} info="variance">
          <RankBars data={varRows.map(r => ({ name: r.name, value: r.variance, id: r.k, sub: `Ach ${pctf(r.ach)} · target ${inr(r.target)}`, color: r.variance >= 0 ? t.series[0] : t.series[7] }))} labelWidth={120} />
        </Card>
      </div>

      <Card className="mt-4" title={`Performance by ${level}`} subtitle="Red rows: achievement below 80% (exception). Click a row to filter the dashboard." info="achievement">
        <DataTable rows={rows} initialSort="sales" pageSize={15} exportName={`sales-performance-${level}`} onRowClick={r => setDim(level, [r.k])}
          rowClass={r => (r.ach < 80 ? 'bg-critical-bg/50' : r.ach < 90 ? 'bg-warn-bg/40' : undefined)}
          columns={perfColumns(level)} />
      </Card>

      <Card className="mt-4" title="Why did sales change? — drill-down" subtitle="Region → State → Distributor → Salesperson → Beat → Outlet → SKU, compared with the same period last year">
        <DrillExplorer />
      </Card>
      <p className="mt-3 text-[11px] text-muted">Dataset: {ds.sales.n.toLocaleString('en-IN')} transaction lines.</p>
    </div>
  )
}

function PerformerList({ rows, onPick }: { rows: PerfRow[]; onPick: (r: PerfRow) => void }) {
  if (!rows.length) return <p className="py-6 text-center text-xs text-muted">No targets in scope</p>
  return (
    <ul className="divide-y divide-line">
      {rows.map(r => (
        <li key={r.k} onClick={() => onPick(r)} className="flex cursor-pointer items-center gap-3 py-2 hover:bg-surface-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{r.name}</p>
            <p className="truncate text-[11px] text-muted">{r.context || r.code} · {inr(r.secNet)} of {inr(r.target)}</p>
            <div className="mt-1"><InlineBar value={r.ach} max={130} tone={achTone(r.ach)} /></div>
          </div>
          <Badge tone={achTone(r.ach)}>{pctf(r.ach)}</Badge>
        </li>
      ))}
    </ul>
  )
}

export function perfColumns(level: string) {
  return [
    { key: 'name', header: level[0].toUpperCase() + level.slice(1), value: (r: PerfRow) => r.name, render: (r: PerfRow) => <div className="max-w-[230px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{[r.code, r.context].filter(Boolean).join(' · ')}</p></div> },
    { key: 'sales', header: 'Sales', align: 'right' as const, value: (r: PerfRow) => r.sales, render: (r: PerfRow) => inr(r.sales) },
    { key: 'prior', header: 'LY', align: 'right' as const, value: (r: PerfRow) => r.prior, render: (r: PerfRow) => inr(r.prior) },
    { key: 'growth', header: 'Growth', align: 'right' as const, value: (r: PerfRow) => r.growth, render: (r: PerfRow) => <span className={r.growth < 0 ? 'text-critical' : 'text-good'}>{signedPct(r.growth)}</span> },
    { key: 'target', header: 'Target', align: 'right' as const, value: (r: PerfRow) => r.target, render: (r: PerfRow) => inr(r.target) },
    { key: 'ach', header: 'Ach %', align: 'right' as const, value: (r: PerfRow) => r.ach, render: (r: PerfRow) => (Number.isNaN(r.ach) ? '—' : <Badge tone={achTone(r.ach)}>{pctf(r.ach)}</Badge>) },
    { key: 'variance', header: 'Variance', align: 'right' as const, value: (r: PerfRow) => r.variance, render: (r: PerfRow) => <span className={r.variance < 0 ? 'text-critical' : 'text-good'}>{inr(r.variance)}</span> },
    { key: 'qty', header: 'Units', align: 'right' as const, value: (r: PerfRow) => r.qty, render: (r: PerfRow) => num(r.qty) },
    { key: 'margin', header: 'Margin', align: 'right' as const, value: (r: PerfRow) => r.margin, render: (r: PerfRow) => inr(r.margin) },
    { key: 'marginPct', header: 'Margin %', align: 'right' as const, value: (r: PerfRow) => r.marginPct, render: (r: PerfRow) => pctf(r.marginPct) },
    { key: 'contribution', header: 'Share', align: 'right' as const, value: (r: PerfRow) => r.contribution, render: (r: PerfRow) => pctf(r.contribution) },
  ]
}
