import { useMemo, useState } from 'react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { periodLabel, priorPeriod } from '../state/filters'
import { aggregate, growth, outletStats, pct, targets, type OutletDim, type Scope } from '../analytics/engine'
import { labelOf } from '../analytics/views'
import type { Dataset } from '../data/types'
import type { Filters } from '../state/filters'
import { Badge, Card, KpiCard, PageHeader, Segmented, achTone, InlineBar, type Tone } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { ColumnChart, ComboChart } from '../charts/Charts'
import { useChartTheme } from '../charts/theme'
import { inr, num, num1, pctf, signedPct } from '../utils/format'

interface ProdRow {
  k: number; name: string; code: string; context: string
  sales: number; prior: number; growth: number; target: number; ach: number
  active: number; productive: number; productivity: number; orders: number; lines: number; lpc: number
  aov: number; spo: number; qty: number; score: number
}

/** Productivity by salesperson / beat / outlet type. Productive outlets are averaged per month (monthly ECO). */
export function productivity(ds: Dataset, sc: Scope, f: Filters, dim: OutletDim & ('salesperson' | 'beat' | 'outletType' | 'distributor' | 'total')): ProdRow[] {
  const months = f.to - f.from + 1
  const agg = aggregate(ds, sc, { from: f.from, to: f.to, types: f.basis, by: dim })
  const pp = priorPeriod(f)
  const prev = pp ? aggregate(ds, sc, { ...pp, types: f.basis, by: dim }) : null
  const sec = aggregate(ds, sc, { from: f.from, to: f.to, types: 'net_secondary', by: dim })
  const tgt = dim === 'salesperson' || dim === 'distributor' || dim === 'total' ? targets(ds, sc, f.from, f.to, dim) : null
  const whole = outletStats(ds, sc, f.from, f.to, dim)
  const prodSum = new Float64Array(whole.n), actSum = new Float64Array(whole.n)
  for (let m = f.from; m <= f.to; m++) {
    const o = outletStats(ds, sc, m, m, dim)
    for (let k = 0; k < o.n; k++) { prodSum[k] += o.productive[k]; actSum[k] += o.active[k] }
  }
  const rows: ProdRow[] = []
  for (let k = 0; k < whole.n; k++) {
    if (!whole.active[k] && !agg.net[k]) continue
    const productive = prodSum[k] / months, active = actSum[k] / months
    const t = tgt ? tgt[k] : NaN
    rows.push({
      k, name: nameOf(ds, dim, k), code: codeOf(ds, dim, k), context: ctxOf(ds, dim, k),
      sales: agg.net[k], prior: prev ? prev.net[k] : NaN, growth: growth(agg.net[k], prev ? prev.net[k] : NaN),
      target: t, ach: t > 0 ? (sec.net[k] / t) * 100 : NaN, active, productive, productivity: pct(productive, active),
      orders: whole.orders[k], lines: whole.lines[k], lpc: whole.orders[k] ? whole.lines[k] / whole.orders[k] : NaN,
      aov: whole.orders[k] ? whole.net[k] / whole.orders[k] : NaN, spo: whole.productive[k] ? whole.net[k] / whole.productive[k] : NaN,
      qty: agg.qty[k], score: 0,
    })
  }
  const spos = rows.map(r => r.spo).filter(Number.isFinite).sort((a, b) => a - b)
  const medSpo = spos[Math.floor(spos.length / 2)] || 1
  for (const r of rows) {
    const a = Number.isFinite(r.ach) ? Math.min(r.ach, 120) / 120 : 0.5
    const p = Number.isFinite(r.productivity) ? r.productivity / 100 : 0
    const s = Number.isFinite(r.spo) ? Math.min(r.spo / medSpo, 2) / 2 : 0
    r.score = 100 * (0.5 * a + 0.3 * p + 0.2 * s)
  }
  return rows
}
const nameOf = (ds: Dataset, dim: string, k: number) => dim === 'salesperson' ? ds.m.salespersons.name[k] : dim === 'beat' ? ds.m.beats.name[k] : dim === 'outletType' ? ds.m.outletTypes[k] : dim === 'distributor' ? ds.m.distributors.name[k] : 'Total'
const codeOf = (ds: Dataset, dim: string, k: number) => dim === 'salesperson' ? ds.m.salespersons.id[k] : dim === 'beat' ? ds.m.beats.id[k] : dim === 'distributor' ? ds.m.distributors.id[k] : ''
const ctxOf = (ds: Dataset, dim: string, k: number) => dim === 'salesperson' ? `${ds.m.distributors.name[ds.spDist[k]]} · ${ds.m.states.name[ds.distState[ds.spDist[k]]]}` : dim === 'beat' ? `${ds.m.salespersons.name[ds.beatSp[k]]} · visits ${ds.m.beats.visitDay[k]}` : ''

const prodTone = (p: number): Tone => (Number.isNaN(p) ? 'neutral' : p >= 65 ? 'good' : p >= 50 ? 'warn' : p >= 40 ? 'serious' : 'critical')

export default function SalesForce() {
  const ds = useData()
  const { filters: f, scope: sc, setDim } = useFilters()
  const t = useChartTheme()
  const [tab, setTab] = useState<'salesperson' | 'beat' | 'outlet'>('salesperson')

  const d = useMemo(() => {
    const total = productivity(ds, sc, f, 'total')[0]
    const sps = productivity(ds, sc, f, 'salesperson')
    const types = productivity(ds, sc, f, 'outletType')
    const tw = { from: Math.max(0, f.to - 11), to: f.to }
    const monthly = outletStats(ds, sc, tw.from, tw.to, 'month')
    const trend = []
    for (let m = tw.from; m <= tw.to; m++) trend.push({ label: labelOf(m), active: monthly.active[m], productive: monthly.productive[m], productivity: pct(monthly.productive[m], monthly.active[m]), orders: monthly.orders[m] })
    const bins = [0, 70, 80, 90, 100, 110, Infinity]
    const hist = bins.slice(0, -1).map((lo, i) => ({ label: i === 0 ? '<70%' : i === bins.length - 2 ? '≥110%' : `${lo}-${bins[i + 1]}%`, count: sps.filter(r => r.ach >= lo && r.ach < bins[i + 1]).length }))
    return { total, sps, types, trend, hist }
  }, [ds, sc, f])

  const beats = useMemo(() => tab === 'beat' ? productivity(ds, sc, f, 'beat') : [], [ds, sc, f, tab])
  const outlets = useMemo(() => tab === 'outlet' ? outletRows(ds, sc, f) : [], [ds, sc, f, tab])
  const T = d.total

  return (
    <div>
      <PageHeader title="Salesperson & Beat Analytics" subtitle={`${periodLabel(f)} · productive outlets are monthly averages (outlets billed in a month ÷ outlets on beat)`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Sales" info="sales" value={inr(T?.sales ?? NaN)} delta={T?.growth} />
        <KpiCard label="Achievement %" info="achievement" value={pctf(T?.ach ?? NaN)} tone={achTone(T?.ach ?? NaN)} sub={`Target ${inr(T?.target ?? NaN)}`} />
        <KpiCard label="Active Outlets" info="active_outlets" value={num(T?.active ?? NaN)} sub="avg per month" />
        <KpiCard label="Productive Outlets" info="productive_outlets" value={num(T?.productive ?? NaN)} sub={`${pctf(T?.productivity ?? NaN)} productivity`} tone={prodTone(T?.productivity ?? NaN)} />
        <KpiCard label="Sales per Outlet" info="sales_per_outlet" value={inr(T?.spo ?? NaN)} sub="per productive outlet" />
        <KpiCard label="Avg Order Value" info="aov" value={inr(T?.aov ?? NaN)} sub={`${num(T?.orders ?? NaN)} orders · ${num1(T?.lpc ?? NaN)} lines/call`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Outlet coverage & productivity" subtitle="Active vs productive outlets by month" info="productivity">
          <ComboChart height={240} data={d.trend} tipFmt={num} yFmt={v => num(v)} series={[
            { key: 'active', name: 'Active outlets', color: t.prior },
            { key: 'productive', name: 'Productive outlets', color: t.secondary },
          ]} />
        </Card>
        <Card title="Salesperson achievement distribution" subtitle="Number of salespersons by achievement band" info="achievement">
          <ColumnChart height={255} data={d.hist} tipFmt={num} yFmt={v => num(v)} series={[{ key: 'count', name: 'Salespersons', color: t.secondary }]} />
        </Card>
        <Card title="Productivity by outlet type" subtitle="Sales per productive outlet and productivity %" info="sales_per_outlet">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Outlet type</th><th className="py-1 text-right font-medium">Outlets</th><th className="py-1 text-right font-medium">Productivity</th><th className="py-1 text-right font-medium">Sales/outlet</th><th className="py-1 text-right font-medium">AOV</th></tr></thead>
            <tbody>{d.types.sort((a, b) => b.sales - a.sales).map(r => (
              <tr key={r.k} className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => setDim('outletType', [r.k])}>
                <td className="py-1.5 font-medium">{r.name}</td><td className="py-1.5 text-right tabular">{num(r.active)}</td>
                <td className="py-1.5 text-right"><Badge tone={prodTone(r.productivity)} icon={false}>{pctf(r.productivity, 0)}</Badge></td>
                <td className="py-1.5 text-right tabular">{inr(r.spo)}</td><td className="py-1.5 text-right tabular">{inr(r.aov)}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      </div>

      <Card className="mt-4" title="Productivity ranking" subtitle="Score = 50% achievement (capped 120%) + 30% outlet productivity + 20% sales per outlet vs median"
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'salesperson', label: 'Salespersons' }, { value: 'beat', label: 'Beats' }, { value: 'outlet', label: 'Outlets' }]} />}>
        {tab === 'salesperson' && (
          <DataTable rows={d.sps} initialSort="score" pageSize={15} exportName="salesperson-ranking" onRowClick={r => setDim('salesperson', [r.k])}
            rowClass={r => (r.ach < 80 || r.productivity < 40 ? 'bg-critical-bg/40' : undefined)} columns={[
              { key: 'rank', header: '#', value: r => d.sps.filter(x => x.score > r.score).length + 1, render: r => <span className="text-muted">{d.sps.filter(x => x.score > r.score).length + 1}</span>, width: '36px' },
              { key: 'name', header: 'Salesperson', value: r => r.name, render: r => <div className="max-w-[200px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{r.code} · {r.context}</p></div> },
              { key: 'score', header: 'Score', align: 'right', value: r => r.score, render: r => <div className="flex items-center justify-end gap-1.5"><span className="w-10"><InlineBar value={r.score} /></span>{num(r.score)}</div> },
              { key: 'sales', header: 'Sales', align: 'right', value: r => r.sales, render: r => inr(r.sales) },
              { key: 'target', header: 'Target', align: 'right', value: r => r.target, render: r => inr(r.target) },
              { key: 'ach', header: 'Ach %', align: 'right', value: r => r.ach, render: r => <Badge tone={achTone(r.ach)}>{pctf(r.ach)}</Badge> },
              { key: 'growth', header: 'Growth', align: 'right', value: r => r.growth, render: r => signedPct(r.growth) },
              { key: 'active', header: 'Active', align: 'right', value: r => r.active, render: r => num(r.active) },
              { key: 'productive', header: 'Productive', align: 'right', value: r => r.productive, render: r => num(r.productive) },
              { key: 'productivity', header: 'Prod. %', align: 'right', value: r => r.productivity, render: r => <Badge tone={prodTone(r.productivity)} icon={false}>{pctf(r.productivity, 0)}</Badge> },
              { key: 'spo', header: 'Sales/outlet', align: 'right', value: r => r.spo, render: r => inr(r.spo) },
              { key: 'orders', header: 'Orders', align: 'right', value: r => r.orders, render: r => num(r.orders) },
              { key: 'aov', header: 'AOV', align: 'right', value: r => r.aov, render: r => inr(r.aov) },
              { key: 'lpc', header: 'LPC', align: 'right', value: r => r.lpc, render: r => num1(r.lpc) },
              { key: 'qty', header: 'Units', align: 'right', value: r => r.qty, render: r => num(r.qty) },
            ]} />
        )}
        {tab === 'beat' && (
          <DataTable rows={beats} initialSort="sales" pageSize={15} exportName="beat-productivity" onRowClick={r => setDim('beat', [r.k])}
            rowClass={r => (r.productivity < 40 ? 'bg-critical-bg/40' : undefined)} columns={[
              { key: 'name', header: 'Beat', value: r => r.name, render: r => <div className="max-w-[220px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{r.code} · {r.context}</p></div> },
              { key: 'sales', header: 'Sales', align: 'right', value: r => r.sales, render: r => inr(r.sales) },
              { key: 'growth', header: 'Growth', align: 'right', value: r => r.growth, render: r => signedPct(r.growth) },
              { key: 'active', header: 'Active outlets', align: 'right', value: r => r.active, render: r => num(r.active) },
              { key: 'productive', header: 'Productive', align: 'right', value: r => r.productive, render: r => num1(r.productive) },
              { key: 'productivity', header: 'Prod. %', align: 'right', value: r => r.productivity, render: r => <Badge tone={prodTone(r.productivity)} icon={false}>{pctf(r.productivity, 0)}</Badge> },
              { key: 'spo', header: 'Sales/outlet', align: 'right', value: r => r.spo, render: r => inr(r.spo) },
              { key: 'orders', header: 'Orders', align: 'right', value: r => r.orders, render: r => num(r.orders) },
              { key: 'aov', header: 'AOV', align: 'right', value: r => r.aov, render: r => inr(r.aov) },
              { key: 'lpc', header: 'LPC', align: 'right', value: r => r.lpc, render: r => num1(r.lpc) },
            ]} />
        )}
        {tab === 'outlet' && (
          <DataTable rows={outlets} initialSort="sales" pageSize={15} exportName="outlet-performance" searchPlaceholder="Search outlet, type, beat…" columns={[
            { key: 'name', header: 'Outlet', value: r => r.name, render: r => <div className="max-w-[220px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{r.id} · {r.city}</p></div> },
            { key: 'type', header: 'Type', value: r => r.type },
            { key: 'beat', header: 'Beat', value: r => r.beat },
            { key: 'sales', header: 'Sales', align: 'right', value: r => r.sales, render: r => inr(r.sales) },
            { key: 'prior', header: 'LY', align: 'right', value: r => r.prior, render: r => inr(r.prior) },
            { key: 'growth', header: 'Growth', align: 'right', value: r => r.growth, render: r => <span className={r.growth < 0 ? 'text-critical' : ''}>{signedPct(r.growth)}</span> },
            { key: 'orders', header: 'Orders', align: 'right', value: r => r.orders, render: r => num(r.orders) },
            { key: 'aov', header: 'AOV', align: 'right', value: r => r.aov, render: r => inr(r.aov) },
            { key: 'months', header: 'Months billed', align: 'right', value: r => r.monthsBilled, render: r => `${r.monthsBilled} / ${f.to - f.from + 1}` },
          ]} />
        )}
      </Card>
    </div>
  )
}

function outletRows(ds: Dataset, sc: Scope, f: Filters) {
  const cur = aggregate(ds, sc, { from: f.from, to: f.to, types: f.basis, by: 'outlet' })
  const pp = priorPeriod(f)
  const prev = pp ? aggregate(ds, sc, { ...pp, types: f.basis, by: 'outlet' }) : null
  const st = outletStats(ds, sc, f.from, f.to, 'outlet')
  const billed = aggregate(ds, sc, { from: f.from, to: f.to, types: 'secondary', by: 'outlet', by2: 'month' })
  const nM = ds.months.length
  const rows = []
  for (let o = 0; o < ds.counts.outlet; o++) {
    if (!sc.outletOK[o] || (!cur.net[o] && !(prev && prev.net[o]))) continue
    let mb = 0
    for (let m = f.from; m <= f.to; m++) if (billed.lines[o * nM + m] > 0) mb++
    rows.push({
      id: ds.m.outlets.id[o], name: ds.m.outlets.name[o], city: ds.m.outlets.city[o], type: ds.m.outletTypes[ds.outletType[o]], beat: ds.m.beats.name[ds.outletBeat[o]],
      sales: cur.net[o], prior: prev ? prev.net[o] : NaN, growth: growth(cur.net[o], prev ? prev.net[o] : NaN), orders: st.orders[o],
      aov: st.orders[o] ? st.net[o] / st.orders[o] : NaN, monthsBilled: mb,
    })
  }
  return rows
}
