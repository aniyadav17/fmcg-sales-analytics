import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lightbulb } from 'lucide-react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { BASIS_LABEL, periodLabel, priorPeriod } from '../state/filters'
import { aggregate, distinctCount, growth, outletStats, pct, sum, targets } from '../analytics/engine'
import { monthlySeries, perfByDim, trendWindow } from '../analytics/views'
import { stockSnapshot, summarizeStock } from '../analytics/stock'
import { collectionStats } from '../analytics/collections'
import { Card, KpiCard, PageHeader, achTone, Note, InlineBar, Badge } from '../components/ui'
import { ComboChart, Donut, RankBars } from '../charts/Charts'
import { useChartTheme } from '../charts/theme'
import { inr, num, pctf, signedPct } from '../utils/format'

export default function Executive() {
  const ds = useData()
  const { filters: f, scope: sc, setDim } = useFilters()
  const t = useChartTheme()
  const nav = useNavigate()

  const d = useMemo(() => {
    const pp = priorPeriod(f)
    const tot = (types: Parameters<typeof aggregate>[2]['types'], from = f.from, to = f.to) => aggregate(ds, sc, { from, to, types })
    const cur = tot(f.basis), prev = pp ? tot(f.basis, pp.from, pp.to) : null
    const prim = tot('primary'), primPrev = pp ? tot('primary', pp.from, pp.to) : null
    const sec = tot('net_secondary'), secPrev = pp ? tot('net_secondary', pp.from, pp.to) : null
    const ret = tot('returns'), secGross = tot('secondary')
    const tgt = targets(ds, sc, f.from, f.to, 'total')
    const dists = distinctCount(ds, sc, f.from, f.to, [true, true, false], 'distributor')[0]
    // outlet productivity is tracked monthly (outlets billed in the month ÷ outlets on beat), then averaged
    const om = outletStats(ds, sc, f.from, f.to, 'month')
    const nm = f.to - f.from + 1
    const os = { active: sum(om.active) / nm, productive: sum(om.productive) / nm }
    const stockRows = stockSnapshot(ds, sc, f.to)
    const stock = summarizeStock(stockRows, ds, f.to)
    const coll = collectionStats(ds, sc, f.from, f.to)
    const w = trendWindow(f)
    const series = monthlySeries(ds, sc, f, w.from, w.to)
    const regions = perfByDim(ds, sc, f, 'region', { keepZero: false })
    const cats = perfByDim(ds, sc, f, 'category')
    const topD = perfByDim(ds, sc, f, 'distributor').sort((a, b) => b.sales - a.sales).slice(0, 10)
    const topS = perfByDim(ds, sc, f, 'sku').sort((a, b) => b.sales - a.sales).slice(0, 10)
    return { cur: cur.net[0], prev: prev?.net[0] ?? NaN, cost: cur.cost[0], prim: prim.net[0], primPrev: primPrev?.net[0] ?? NaN,
      sec: sec.net[0], secPrev: secPrev?.net[0] ?? NaN, ret: ret.net[0], secGross: secGross.net[0], tgt: tgt ? tgt[0] : NaN,
      dists, os, stock, coll, series, regions, cats, topD, topS, qty: cur.qty[0] }
  }, [ds, sc, f])

  const ach = pct(d.sec, d.tgt)
  const g = growth(d.cur, d.prev)
  const marginPct = pct(d.cur - d.cost, d.cur)
  const productivity = pct(d.os.productive, d.os.active)
  const insights = useMemo(() => buildInsights(d, ach), [d, ach])

  return (
    <div>
      <PageHeader title="Executive Sales Overview" subtitle={<>{periodLabel(f)} · Sales measured as <b className="font-medium text-ink-2">{BASIS_LABEL[f.basis]}</b> · growth vs same period last year</>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total Sales" info="sales" value={inr(d.cur)} delta={g} sub={`${num(d.qty)} units`} />
        <KpiCard label="Primary Sales" info="primary" value={inr(d.prim)} delta={growth(d.prim, d.primPrev)} />
        <KpiCard label="Secondary Sales (net)" info="secondary" value={inr(d.sec)} delta={growth(d.sec, d.secPrev)} sub={`Returns ${pctf(pct(-d.ret, d.secGross))}`} />
        <KpiCard label="Target" info="target" value={inr(d.tgt)} sub={Number.isNaN(d.tgt) ? 'n/a below salesperson grain' : `Gap ${inr(d.sec - d.tgt)}`} />
        <KpiCard label="Achievement %" info="achievement" value={pctf(ach)} tone={achTone(ach)} footer={<div className="mt-1.5"><InlineBar value={ach} max={120} tone={achTone(ach)} /></div>} />
        <KpiCard label="Sales Growth %" info="growth" value={signedPct(g)} tone={Number.isNaN(g) ? 'neutral' : g >= 0 ? 'good' : 'critical'} sub={Number.isNaN(g) ? 'no prior-year data' : `LY ${inr(d.prev)}`} />
        <KpiCard label="Gross Margin" info="margin" value={inr(d.cur - d.cost)} sub={`${pctf(marginPct)} margin`} />
        <KpiCard label="Active Distributors" info="active_distributors" value={num(d.dists)} sub={`of ${num(sum(sc.distOK))} in scope`} onClick={() => nav('/distributors')} />
        <KpiCard label="Active Outlets" info="active_outlets" value={num(d.os.active)} sub="outlet universe (avg / month)" onClick={() => nav('/salesforce')} />
        <KpiCard label="Productive Outlets" info="productive_outlets" value={num(d.os.productive)} sub={`${pctf(productivity)} billed per month`} tone={productivity >= 65 ? 'good' : productivity >= 50 ? 'warn' : 'serious'} />
        <KpiCard label="Distributor Stock" info="stock_value" value={inr(d.stock.value)} sub={`${Math.round(d.stock.coverDays)} days cover`} onClick={() => nav('/inventory')} />
        <KpiCard label="Outstanding" info="outstanding" value={inr(d.coll.outstanding[0])} sub={`Overdue ${inr(d.coll.overdue[0])}`} tone={d.coll.overdue[0] / d.coll.outstanding[0] > 0.3 ? 'serious' : 'neutral'} onClick={() => nav('/collections')} />
      </div>

      {insights.length > 0 && (
        <Card className="mt-4" title={<span className="flex items-center gap-1.5"><Lightbulb size={15} className="text-accent" />Management summary</span>} subtitle="Auto-generated from the current filters">
          <ul className="grid gap-x-6 gap-y-1.5 text-[13px] text-ink-2 md:grid-cols-2">
            {insights.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /><span>{s}</span></li>)}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Monthly sales trend" subtitle={`${BASIS_LABEL[f.basis]} vs same month last year`} info="growth">
          <ComboChart data={d.series} series={[
            { key: 'sales', name: 'This year', color: t.secondary },
            { key: 'prior', name: 'Last year', color: t.prior, type: 'line' },
          ]} />
        </Card>
        <Card title="Target vs achievement" subtitle="Net secondary sales against monthly target" info="achievement">
          {Number.isNaN(d.tgt) ? <Note>Targets are set at salesperson × category grain and are not available when a Beat or Outlet-type filter is applied.</Note> : (
            <ComboChart data={d.series} series={[
              { key: 'secondary', name: 'Net secondary', color: t.secondary },
              { key: 'target', name: 'Target', color: t.target, type: 'line' },
            ]} />
          )}
        </Card>
        <Card title="Primary vs secondary sales" subtitle="Sell-in (company → distributor) vs sell-out (distributor → outlet)" info="ps_ratio">
          <ComboChart data={d.series} series={[
            { key: 'primary', name: 'Primary', color: t.primary, type: 'line' },
            { key: 'secondary', name: 'Secondary (net)', color: t.secondary, type: 'line' },
          ]} />
          <p className="mt-1 text-[11px] text-muted">Primary / secondary ratio for the period: <b className="text-ink-2">{(d.prim / d.sec).toFixed(2)}</b> (0.88–1.02 is balanced: primary is billed at distributor price while the pipeline grows). Quarter-end spikes in primary indicate pipeline loading.</p>
        </Card>
        <Card title="Region performance" subtitle="Sales, achievement and growth by region" info="achievement">
          <RegionTable rows={d.regions} onPick={k => setDim('region', [k])} />
        </Card>
        <Card title="Category contribution" subtitle="Share of sales and growth by category" info="contribution">
          <Donut data={d.cats.sort((a, b) => b.sales - a.sales).map(c => ({ name: c.name, value: c.sales, color: t.series[c.k] }))} center={<><span className="text-[11px] text-muted">Total</span><span className="text-sm font-semibold text-ink">{inr(d.cur)}</span></>} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {d.cats.map(c => <Badge key={c.k} tone={Number.isNaN(c.growth) ? 'neutral' : c.growth >= 0 ? 'good' : 'critical'} icon={false}>{c.name} {signedPct(c.growth)}</Badge>)}
          </div>
        </Card>
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Card title="Top 10 distributors" subtitle="Click a bar to filter" info="sales">
            <RankBars data={d.topD.map(r => ({ name: r.name, value: r.sales, sub: `${r.context} · growth ${signedPct(r.growth)}`, id: r.k }))} onClick={r => setDim('distributor', [r.id!])} />
          </Card>
          <Card title="Top 10 SKUs" subtitle="Click a bar to filter" info="sales">
            <RankBars data={d.topS.map(r => ({ name: r.name, value: r.sales, sub: `${r.context} · growth ${signedPct(r.growth)}`, id: r.k, color: t.series[ds.skuCat[r.k]] }))} onClick={r => setDim('sku', [r.id!])} labelWidth={170} />
          </Card>
        </div>
      </div>
    </div>
  )
}

function RegionTable({ rows, onPick }: { rows: ReturnType<typeof perfByDim>; onPick: (k: number) => void }) {
  const max = Math.max(...rows.map(r => r.sales), 1)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-muted">
          <th className="py-1.5 font-medium">Region</th><th className="py-1.5 font-medium">Sales</th><th className="py-1.5 text-right font-medium">Target</th>
          <th className="py-1.5 text-right font-medium">Ach %</th><th className="py-1.5 text-right font-medium">Growth</th><th className="py-1.5 text-right font-medium">Margin %</th>
        </tr></thead>
        <tbody>
          {rows.sort((a, b) => b.sales - a.sales).map(r => (
            <tr key={r.k} onClick={() => onPick(r.k)} className="cursor-pointer border-t border-line hover:bg-surface-2">
              <td className="py-2 pr-2 font-medium text-ink">{r.name}</td>
              <td className="w-[38%] py-2 pr-3"><div className="flex items-center gap-2"><span className="w-16 shrink-0 tabular">{inr(r.sales)}</span><InlineBar value={r.sales} max={max} /></div></td>
              <td className="py-2 text-right tabular text-ink-2">{inr(r.target)}</td>
              <td className="py-2 text-right"><Badge tone={achTone(r.ach)}>{pctf(r.ach)}</Badge></td>
              <td className={`py-2 text-right tabular ${r.growth >= 0 ? 'text-good' : 'text-critical'}`}>{signedPct(r.growth)}</td>
              <td className="py-2 text-right tabular text-ink-2">{pctf(r.marginPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">Click a region to drill into it (applies the Region filter).</p>
    </div>
  )
}

type ExecData = {
  cur: number; prev: number; sec: number; tgt: number; prim: number
  regions: ReturnType<typeof perfByDim>; cats: ReturnType<typeof perfByDim>; topD: ReturnType<typeof perfByDim>
  stock: ReturnType<typeof summarizeStock>; coll: ReturnType<typeof collectionStats>
}
function buildInsights(d: ExecData, ach: number): string[] {
  const out: string[] = []
  const g = growth(d.cur, d.prev)
  if (!Number.isNaN(g)) {
    const byG = [...d.regions].filter(r => !Number.isNaN(r.growth)).sort((a, b) => b.growth - a.growth)
    out.push(`Sales ${g >= 0 ? 'grew' : 'declined'} ${signedPct(g)} vs last year to ${inr(d.cur)}${byG.length > 1 ? `; ${byG[0].name} led (${signedPct(byG[0].growth)}) while ${byG[byG.length - 1].name} lagged (${signedPct(byG[byG.length - 1].growth)})` : ''}.`)
  }
  if (!Number.isNaN(ach)) {
    const below = d.regions.filter(r => r.ach < 95)
    out.push(`Secondary achievement is ${pctf(ach)} of target (gap ${inr(d.sec - d.tgt)})${below.length ? `; ${below.map(r => `${r.name} ${pctf(r.ach, 0)}`).join(', ')} below 95%` : '; every region is at or above 95%'}.`)
  }
  const cg = [...d.cats].filter(c => !Number.isNaN(c.growth)).sort((a, b) => b.growth - a.growth)
  if (cg.length > 1) out.push(`Fastest-growing category: ${cg[0].name} (${signedPct(cg[0].growth)}); slowest: ${cg[cg.length - 1].name} (${signedPct(cg[cg.length - 1].growth)}).`)
  const ratio = d.prim / d.sec
  if (Number.isFinite(ratio)) out.push(ratio > 1.02 ? `Primary is running ahead of secondary (ratio ${ratio.toFixed(2)}) — pipeline is being loaded; watch distributor stock.` : ratio < 0.88 ? `Primary is lagging secondary (ratio ${ratio.toFixed(2)}) — distributors are de-stocking; check stock-outs.` : `Primary and secondary are balanced (ratio ${ratio.toFixed(2)}).`)
  const risk = d.stock.valueByStatus['Slow-moving'] + d.stock.valueByStatus['Non-moving']
  if (d.stock.value > 0) out.push(`Distributor stock is ${inr(d.stock.value)} (${Math.round(d.stock.coverDays)} days cover); ${inr(risk)} (${pctf(pct(risk, d.stock.value), 0)}) is slow- or non-moving and ${pctf(d.stock.stockOutPct)} of distributor-SKU lines are out of stock.`)
  const od = d.coll.overdue[0]
  if (d.coll.outstanding[0] > 0) out.push(`Receivables of ${inr(d.coll.outstanding[0])}, of which ${inr(od)} is overdue and ${inr(d.coll.ageing[4][0])} is more than 90 days past due.`)
  if (d.topD.length) {
    const top10 = d.topD.reduce((a, r) => a + r.sales, 0)
    out.push(`Top 10 distributors contribute ${pctf(pct(top10, d.cur), 0)} of sales — ${pct(top10, d.cur) > 40 ? 'high concentration risk' : 'a well-spread network'}.`)
  }
  return out
}
