import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { periodLabel, priorPeriod } from '../state/filters'
import { aggregate, buildScope, growth, pct, targets } from '../analytics/engine'
import { stockSnapshot, stockValueTrend } from '../analytics/stock'
import { cei, collectionStats } from '../analytics/collections'
import { labelOf } from '../analytics/views'
import { Badge, Card, KpiCard, PageHeader, achTone, cx, type Tone } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { ComboChart, QuadrantScatter, SeriesLegend } from '../charts/Charts'
import { useChartTheme } from '../charts/theme'
import { days, inr, pctf, signedPct } from '../utils/format'

export interface DistRow {
  d: number; name: string; id: string; region: string; state: string; type: string; status: string
  target: number; primary: number; secondary: number; secPrior: number; ach: number; growth: number
  stock: number; cover: number; outstanding: number; overdue: number; cei: number; creditLimit: number; avgMonthlySec: number
  quadrant: 0 | 1 | 2 | 3
}

const QUAD = ['High sales · High stock', 'Low sales · High stock', 'High sales · Low stock', 'Low sales · Low stock'] as const

export function useDistributorRows() {
  const ds = useData()
  const { filters: f, scope: sc } = useFilters()
  return useMemo(() => {
    const nD = ds.counts.distributor
    const pp = priorPeriod(f)
    const prim = aggregate(ds, sc, { from: f.from, to: f.to, types: 'primary', by: 'distributor' })
    const sec = aggregate(ds, sc, { from: f.from, to: f.to, types: 'net_secondary', by: 'distributor' })
    const secP = pp ? aggregate(ds, sc, { ...pp, types: 'net_secondary', by: 'distributor' }) : null
    const tgt = targets(ds, sc, f.from, f.to, 'distributor')
    const snap = stockSnapshot(ds, sc, f.to)
    const stockV = new Float64Array(nD), cogsDaily = new Float64Array(nD)
    const pp2 = ds.monthPricePeriod[f.to]
    for (const r of snap) { stockV[r.dist] += r.value; cogsDaily[r.dist] += (r.sales3m * ds.ptd[r.sku * 6 + pp2]) / 91 }
    const col = collectionStats(ds, sc, f.from, f.to, 'distributor')
    const months = f.to - f.from + 1
    const rows: DistRow[] = []
    for (let d = 0; d < nD; d++) {
      if (!sc.primaryDistOK[d]) continue
      if (!prim.net[d] && !sec.net[d] && !stockV[d]) continue
      const m = ds.m.distributors
      rows.push({
        d, name: m.name[d], id: m.id[d], region: ds.m.regions[ds.distRegion[d]], state: ds.m.states.name[ds.distState[d]],
        type: m.type[d], status: m.status[d], target: tgt ? tgt[d] : NaN, primary: prim.net[d], secondary: sec.net[d],
        secPrior: secP ? secP.net[d] : NaN, ach: tgt && tgt[d] ? (sec.net[d] / tgt[d]) * 100 : NaN, growth: growth(sec.net[d], secP ? secP.net[d] : NaN),
        stock: stockV[d], cover: cogsDaily[d] > 0 ? stockV[d] / cogsDaily[d] : stockV[d] > 0 ? Infinity : NaN,
        outstanding: col.outstanding[d], overdue: col.overdue[d], cei: cei(col.opening[d], col.invoiced[d], col.outstanding[d]),
        creditLimit: m.creditLimit[d], avgMonthlySec: sec.net[d] / months, quadrant: 0,
      })
    }
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
    const mx = med(rows.map(r => r.avgMonthlySec)), my = med(rows.map(r => r.stock))
    for (const r of rows) r.quadrant = (r.avgMonthlySec >= mx ? (r.stock >= my ? 0 : 2) : (r.stock >= my ? 1 : 3)) as DistRow['quadrant']
    return { rows, mx, my }
  }, [ds, sc, f])
}

export const coverTone = (c: number): Tone => (!Number.isFinite(c) ? (c === Infinity ? 'critical' : 'neutral') : c < 7 ? 'serious' : c <= 45 ? 'good' : c <= 90 ? 'warn' : 'critical')

export default function Distributors() {
  const { filters: f } = useFilters()
  const t = useChartTheme()
  const { rows, mx, my } = useDistributorRows()
  const [sel, setSel] = useState<number | null>(null)
  const selected = rows.find(r => r.d === sel)

  const tot = rows.reduce((a, r) => ({ p: a.p + r.primary, s: a.s + r.secondary, st: a.st + r.stock, o: a.o + r.outstanding, t: a.t + (r.target || 0) }), { p: 0, s: 0, st: 0, o: 0, t: 0 })
  const quadColor = [t.series[0], t.series[1], t.series[2], t.prior]
  const counts = [0, 1, 2, 3].map(q => rows.filter(r => r.quadrant === q).length)

  return (
    <div>
      <PageHeader title="Distributor Analytics" subtitle={`${periodLabel(f)} · ${rows.length} distributors in scope · stock and outstanding as of ${labelOf(f.to)} month-end`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Primary Sales" info="primary" value={inr(tot.p)} />
        <KpiCard label="Secondary Sales" info="secondary" value={inr(tot.s)} />
        <KpiCard label="Achievement %" info="achievement" value={pctf(pct(tot.s, tot.t))} tone={achTone(pct(tot.s, tot.t))} />
        <KpiCard label="Distributor Stock" info="stock_value" value={inr(tot.st)} />
        <KpiCard label="Outstanding" info="outstanding" value={inr(tot.o)} />
        <KpiCard label="Low sales · High stock" value={counts[1]} sub="distributors — excess stock risk" tone={counts[1] > 0 ? 'serious' : 'good'} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Sales vs stock — distributor quadrant" subtitle="x: avg monthly net secondary · y: closing stock value · lines at the median. Click a point for details." info="stock_cover">
          <SeriesLegend items={QUAD.map((q, i) => ({ name: `${q} (${counts[i]})`, color: quadColor[i] }))} />
          <QuadrantScatter log xLabel="Avg monthly secondary (log)" yLabel="Stock value (log)" xRef={mx} yRef={my}
            quadrants={['Scale: watch cover', 'Excess stock: stop push / liquidate', 'Stock-out risk: raise norms', 'Develop or review']}
            data={rows.map(r => ({ x: r.avgMonthlySec, y: r.stock, name: r.name, id: r.d, sub: `${r.state} · cover ${days(r.cover)} · ach ${pctf(r.ach)}`, color: quadColor[r.quadrant] }))}
            onClick={p => setSel(p.id)} />
        </Card>
        <Card className="xl:col-span-2" title={selected ? selected.name : 'Distributor detail'} subtitle={selected ? `${selected.id} · ${selected.type} · ${selected.state}` : 'Select a distributor in the chart or table'}
          actions={selected && <button aria-label="Close" onClick={() => setSel(null)} className="text-muted hover:text-ink"><X size={16} /></button>}>
          {selected ? <DistributorDetail row={selected} /> : <QuadrantGuide />}
        </Card>
      </div>

      <Card className="mt-4" title="Distributor scorecard" subtitle="Red = achievement < 80% or cover > 90 days; stock cover uses last 3 months' secondary" info="collection_efficiency">
        <DataTable rows={rows} initialSort="secondary" pageSize={15} exportName="distributor-scorecard" onRowClick={r => setSel(r.d)}
          rowClass={r => (r.d === sel ? 'bg-accent-soft' : r.ach < 80 || r.cover > 90 ? 'bg-critical-bg/40' : undefined)}
          columns={[
            { key: 'name', header: 'Distributor', value: r => r.name, render: r => <div className="max-w-[200px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{r.id} · {r.type}{r.status !== 'Active' ? ` · ${r.status}` : ''}</p></div> },
            { key: 'region', header: 'Region', value: r => r.region },
            { key: 'state', header: 'State', value: r => r.state },
            { key: 'target', header: 'Target', align: 'right', value: r => r.target, render: r => inr(r.target) },
            { key: 'primary', header: 'Primary', align: 'right', value: r => r.primary, render: r => inr(r.primary) },
            { key: 'secondary', header: 'Secondary', align: 'right', value: r => r.secondary, render: r => inr(r.secondary) },
            { key: 'ach', header: 'Ach %', align: 'right', value: r => r.ach, render: r => <Badge tone={achTone(r.ach)}>{pctf(r.ach)}</Badge> },
            { key: 'growth', header: 'Growth', align: 'right', value: r => r.growth, render: r => <span className={r.growth < 0 ? 'text-critical' : 'text-good'}>{signedPct(r.growth)}</span> },
            { key: 'stock', header: 'Stock value', align: 'right', value: r => r.stock, render: r => inr(r.stock) },
            { key: 'cover', header: 'Stock cover', align: 'right', value: r => r.cover, render: r => <Badge tone={coverTone(r.cover)} icon={false}>{days(r.cover)}</Badge> },
            { key: 'outstanding', header: 'Outstanding', align: 'right', value: r => r.outstanding, render: r => inr(r.outstanding) },
            { key: 'cei', header: 'Coll. eff.', align: 'right', value: r => r.cei, render: r => <span className={cx(r.cei < 80 && 'font-semibold text-critical')}>{pctf(r.cei)}</span> },
          ]} />
      </Card>
    </div>
  )
}

function QuadrantGuide() {
  const items = [
    ['High sales · High stock', 'Large, healthy distributors. Monitor cover so growth is not financed by excess stock.'],
    ['Low sales · High stock', 'Primary was pushed faster than the market consumed it. Stop loading, run liquidation schemes, transfer stock.'],
    ['High sales · Low stock', 'Demand is there but stock is thin — risk of stock-outs and lost sales. Raise stock norms / credit.'],
    ['Low sales · Low stock', 'Small or under-developed distributors. Review coverage, beat plans and viability.'],
  ]
  return <ul className="space-y-3 text-xs">{items.map(([a, b]) => <li key={a}><p className="font-semibold text-ink">{a}</p><p className="text-ink-2">{b}</p></li>)}</ul>
}

function DistributorDetail({ row }: { row: DistRow }) {
  const ds = useData()
  const { filters: f } = useFilters()
  const t = useChartTheme()
  const data = useMemo(() => {
    const sc = buildScope(ds, { ...f, region: [], state: [], territory: [], distributor: [row.d], salesperson: [], beat: [], outletType: [] })
    const from = Math.max(0, f.to - 17)
    const prim = aggregate(ds, sc, { from, to: f.to, types: 'primary', by: 'month' })
    const sec = aggregate(ds, sc, { from, to: f.to, types: 'net_secondary', by: 'month' })
    const stock = stockValueTrend(ds, sc, from, f.to)
    const out = []
    for (let m = from; m <= f.to; m++) out.push({ label: labelOf(m), primary: prim.net[m], secondary: sec.net[m], stock: stock[m] })
    return out
  }, [ds, f, row.d])
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {[['Achievement', pctf(row.ach), achTone(row.ach)], ['Stock cover', days(row.cover), coverTone(row.cover)], ['Coll. efficiency', pctf(row.cei), row.cei >= 90 ? 'good' : row.cei >= 80 ? 'warn' : 'critical']].map(([k, v, tone]) => (
          <div key={k as string} className="rounded-lg bg-surface-2 p-2"><p className="text-muted">{k}</p><div className="mt-0.5"><Badge tone={tone as Tone}>{v}</Badge></div></div>
        ))}
      </div>
      <p className="mt-3 mb-1 text-xs font-medium text-ink-2">Last 18 months: primary vs secondary vs month-end stock</p>
      <ComboChart height={220} data={data} series={[
        { key: 'primary', name: 'Primary', color: t.primary, type: 'line' },
        { key: 'secondary', name: 'Secondary', color: t.secondary, type: 'line' },
        { key: 'stock', name: 'Stock value', color: t.stock, type: 'line' },
      ]} />
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Outstanding / credit limit</dt><dd className="text-right tabular">{inr(row.outstanding)} / {inr(row.creditLimit)}</dd>
        <dt className="text-muted">Overdue</dt><dd className="text-right tabular">{inr(row.overdue)}</dd>
        <dt className="text-muted">Growth vs LY</dt><dd className="text-right tabular">{signedPct(row.growth)}</dd>
        <dt className="text-muted">Status</dt><dd className="text-right">{row.status}</dd>
      </dl>
    </div>
  )
}
