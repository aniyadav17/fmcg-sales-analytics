import { useMemo, useState } from 'react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { BASIS_LABEL, periodLabel } from '../state/filters'
import { aggregate, distinctCount, growth, pct } from '../analytics/engine'
import { labelOf, perfByDim, type PerfRow } from '../analytics/views'
import { Badge, Card, KpiCard, PageHeader, Segmented, achTone } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { ComboChart, Donut, RankBars } from '../charts/Charts'
import { useChartTheme } from '../charts/theme'
import { inr, num, pctf, signedPct } from '../utils/format'

type Level = 'category' | 'brand' | 'subCategory' | 'sku'

export default function Products() {
  const ds = useData()
  const { filters: f, scope: sc, setDim } = useFilters()
  const t = useChartTheme()
  const [level, setLevel] = useState<Level>('sku')

  const d = useMemo(() => {
    const cats = perfByDim(ds, sc, f, 'category')
    const skus = perfByDim(ds, sc, f, 'sku')
    const cur = aggregate(ds, sc, { from: f.from, to: f.to, types: f.basis })
    const skuCount = distinctCount(ds, sc, f.from, f.to, [false, true, false], 'sku')[0]
    const distCount = distinctCount(ds, sc, f.from, f.to, [true, true, false], 'distributor')[0]
    const w = { from: Math.max(0, f.to - 11), to: f.to }
    const bym = aggregate(ds, sc, { ...w, types: f.basis, by: 'month', by2: 'category' })
    const stack = []
    for (let m = w.from; m <= w.to; m++) {
      const row: Record<string, number | string> = { label: labelOf(m) }
      for (let c = 0; c < 8; c++) row[`c${c}`] = bym.net[m * 8 + c]
      stack.push(row)
    }
    const mw = { from: Math.max(0, f.to - 35), to: f.to }
    const mm = aggregate(ds, sc, { ...mw, types: f.basis, by: 'month' })
    const margin = []
    for (let m = mw.from; m <= mw.to; m++) margin.push({ label: labelOf(m), marginPct: pct(mm.net[m] - mm.cost[m], mm.net[m]) })
    return { cats, skus, cur, skuCount, distCount, stack, margin }
  }, [ds, sc, f])

  const rows = useMemo(() => {
    const r = level === 'sku' ? d.skus : perfByDim(ds, sc, f, level)
    const dc = distinctCount(ds, sc, f.from, f.to, [true, true, false], 'distributor', level)
    return r.map(x => ({ ...x, dists: dc[x.k] }))
  }, [ds, sc, f, level, d.skus])

  const sales = d.cur.net[0], margin = sales - d.cur.cost[0]
  const prior = d.cats.reduce((a, c) => a + (c.prior || 0), 0)
  const active = d.skus.filter(s => s.sales > 0)
  const top = [...active].sort((a, b) => b.sales - a.sales).slice(0, 10)
  const bottom = [...active].sort((a, b) => a.sales - b.sales).slice(0, 10)
  const material = d.skus.filter(s => s.prior > sales * 0.0005)
  const fast = [...material].filter(s => s.growth > 0).sort((a, b) => b.growth - a.growth).slice(0, 10)
  const declining = [...material].filter(s => s.growth < 0).sort((a, b) => a.growth - b.growth).slice(0, 10)
  const pareto = (() => { const s = [...active].sort((a, b) => b.sales - a.sales); let acc = 0, n = 0; for (const x of s) { acc += x.sales; n++; if (acc >= sales * 0.8) break } return n })()
  const skuColor = (k: number) => t.series[ds.skuCat[k]]

  return (
    <div>
      <PageHeader title="Product & SKU Analytics" subtitle={`${periodLabel(f)} · ${BASIS_LABEL[f.basis]}`}>
        <Segmented value={level} onChange={setLevel} options={[{ value: 'category', label: 'Category' }, { value: 'brand', label: 'Brand' }, { value: 'subCategory', label: 'Sub-category' }, { value: 'sku', label: 'SKU' }]} />
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Sales" info="sales" value={inr(sales)} delta={growth(sales, prior)} />
        <KpiCard label="Quantity" value={num(d.cur.qty[0])} sub="units" />
        <KpiCard label="Gross Margin" info="margin" value={inr(margin)} />
        <KpiCard label="Margin %" info="margin_pct" value={pctf(pct(margin, sales))} />
        <KpiCard label="Active SKUs" value={num(d.skuCount)} sub={`${pareto} SKUs make 80% of sales`} info="contribution" />
        <KpiCard label="Active Distributors" info="active_distributors" value={num(d.distCount)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Category contribution" info="contribution">
          <Donut vertical data={[...d.cats].sort((a, b) => b.sales - a.sales).map(c => ({ name: c.name, value: c.sales, color: t.series[c.k] }))} height={180} />
        </Card>
        <Card className="xl:col-span-2" title="Category sales by month" subtitle="Last 12 months ending with the selected period — seasonality is visible by category">
          <ComboChart height={250} data={d.stack} series={ds.m.categories.map((c, i) => ({ key: `c${i}`, name: c, color: t.series[i], stack: 'a' }))} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Top 10 SKUs" subtitle="By sales" info="sales"><RankBars data={top.map(s => ({ name: s.name, value: s.sales, id: s.k, sub: `${s.context} · ${signedPct(s.growth)}`, color: skuColor(s.k) }))} labelWidth={130} onClick={r => setDim('sku', [r.id!])} /></Card>
        <Card title="Bottom 10 SKUs" subtitle="Lowest sales among SKUs that sold" info="sales"><RankBars data={bottom.map(s => ({ name: s.name, value: s.sales, id: s.k, sub: `${s.context} · ${ds.m.skus.status[s.k]}`, color: skuColor(s.k) }))} labelWidth={130} /></Card>
        <Card title="Fast-growing SKUs" subtitle="Growth vs LY (material SKUs)" info="growth"><RankBars data={fast.map(s => ({ name: s.name, value: s.growth, id: s.k, sub: `${inr(s.sales)} · LY ${inr(s.prior)}`, color: skuColor(s.k) }))} fmt={v => signedPct(v, 0)} labelWidth={130} /></Card>
        <Card title="Declining SKUs" subtitle="Largest % decline vs LY (bar = size of the drop)" info="growth"><RankBars data={declining.map(s => ({ name: s.name, value: -s.growth, id: s.k, sub: `${inr(s.sales)} · LY ${inr(s.prior)} · ${ds.m.skus.status[s.k]}`, color: t.series[7] }))} fmt={v => `−${v.toFixed(0)}%`} labelWidth={130} /></Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={`Performance by ${level === 'subCategory' ? 'sub-category' : level === 'sku' ? 'SKU' : level}`} subtitle="Click a row to filter" info="contribution">
          <DataTable rows={rows} initialSort="sales" pageSize={12} exportName={`product-${level}`} onRowClick={(r: PerfRow) => level === 'subCategory' ? undefined : setDim(level, [r.k])}
            rowClass={r => (r.growth < -15 ? 'bg-critical-bg/40' : undefined)}
            columns={[
              { key: 'name', header: level === 'sku' ? 'SKU' : level === 'subCategory' ? 'Sub-category' : level[0].toUpperCase() + level.slice(1), value: r => r.name, render: r => <div className="max-w-[240px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{[r.code, r.context, level === 'sku' ? ds.m.skus.status[r.k] : ''].filter(Boolean).join(' · ')}</p></div> },
              { key: 'sales', header: 'Sales', align: 'right', value: r => r.sales, render: r => inr(r.sales) },
              { key: 'growth', header: 'Growth', align: 'right', value: r => r.growth, render: r => <span className={r.growth < 0 ? 'text-critical' : 'text-good'}>{signedPct(r.growth)}</span> },
              { key: 'qty', header: 'Units', align: 'right', value: r => r.qty, render: r => num(r.qty) },
              { key: 'margin', header: 'Margin', align: 'right', value: r => r.margin, render: r => inr(r.margin) },
              { key: 'marginPct', header: 'Margin %', align: 'right', value: r => r.marginPct, render: r => pctf(r.marginPct) },
              { key: 'contribution', header: 'Contrib. %', align: 'right', value: r => r.contribution, render: r => pctf(r.contribution, 2) },
              { key: 'dists', header: 'Active dist.', align: 'right', value: r => r.dists, render: r => num(r.dists) },
              { key: 'ach', header: 'Ach %', align: 'right', value: r => r.ach, render: r => (Number.isNaN(r.ach) ? '—' : <Badge tone={achTone(r.ach)}>{pctf(r.ach)}</Badge>) },
            ]} />
        </Card>
        <Card title="Gross margin % trend" subtitle="Last 36 months — cost inflation in FY 2022-23 compressed margins" info="margin_pct">
          <ComboChart height={260} data={d.margin} yFmt={v => `${v.toFixed(0)}%`} tipFmt={v => pctf(v)} yDomain={['auto', 'auto']} series={[{ key: 'marginPct', name: 'Margin %', color: t.secondary, type: 'line' }]} />
        </Card>
      </div>
    </div>
  )
}
