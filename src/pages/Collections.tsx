import { useMemo, useState } from 'react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { periodLabel } from '../state/filters'
import { AGE_BUCKETS, cei, collectionStats, collectionTrend, type CollDim } from '../analytics/collections'
import { labelOf, trendWindow } from '../analytics/views'
import { dimName } from '../analytics/engine'
import { Badge, Card, KpiCard, PageHeader, Segmented, Note, type Tone } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { ColumnChart, ComboChart } from '../charts/Charts'
import { useChartTheme } from '../charts/theme'
import { inr, num, pctf } from '../utils/format'

const ceiTone = (v: number): Tone => (Number.isNaN(v) ? 'neutral' : v >= 90 ? 'good' : v >= 80 ? 'warn' : v >= 70 ? 'serious' : 'critical')

export default function Collections() {
  const ds = useData()
  const { filters: f, scope: sc, setDim } = useFilters()
  const t = useChartTheme()
  const [dim, setDimSel] = useState<Exclude<CollDim, 'total'>>('distributor')

  const d = useMemo(() => {
    const tot = collectionStats(ds, sc, f.from, f.to, 'total')
    const w = trendWindow(f)
    const tr = collectionTrend(ds, sc, w.from, w.to)
    const trend = []
    for (let m = w.from; m <= w.to; m++) trend.push({ label: labelOf(m), invoiced: tr.invoiced[m], collected: tr.collected[m] })
    return { tot, trend }
  }, [ds, sc, f])

  const rows = useMemo(() => {
    const s = collectionStats(ds, sc, f.from, f.to, dim)
    const out = []
    for (let k = 0; k < s.n; k++) {
      if (!s.invoiced[k] && !s.outstanding[k] && !s.opening[k]) continue
      const limit = dim === 'distributor' ? ds.m.distributors.creditLimit[k] : NaN
      out.push({
        k, name: dimName(ds, dim, k), sub: dim === 'distributor' ? `${ds.m.distributors.id[k]} · ${ds.m.distributors.type[k]} · ${ds.m.distributors.creditDays[k]}d credit${ds.m.distributors.status[k] !== 'Active' ? ` · ${ds.m.distributors.status[k]}` : ''}` : dim === 'state' ? ds.m.regions[ds.stateRegion[k]] : '',
        invoiced: s.invoiced[k], collected: s.collected[k], collPct: s.invoiced[k] ? (s.collectedOnInvoices[k] / s.invoiced[k]) * 100 : NaN,
        outstanding: s.outstanding[k], overdue: s.overdue[k], od90: s.ageing[4][k], cei: cei(s.opening[k], s.invoiced[k], s.outstanding[k]),
        days: s.collected[k] ? s.daysToCollectW[k] / s.collected[k] : NaN, maxOd: s.maxOverdueDays[k], util: limit ? (s.outstanding[k] / limit) * 100 : NaN,
      })
    }
    return out
  }, [ds, sc, f, dim])

  const T = d.tot
  const collPct = T.invoiced[0] ? (T.collectedOnInvoices[0] / T.invoiced[0]) * 100 : NaN
  const ceiV = cei(T.opening[0], T.invoiced[0], T.outstanding[0])
  const dtc = T.collected[0] ? T.daysToCollectW[0] / T.collected[0] : NaN
  const ageData = AGE_BUCKETS.map((b, i) => ({ label: i === 0 ? b : `${b} days`, value: T.ageing[i][0] }))

  return (
    <div>
      <PageHeader title="Collection Analytics" subtitle={`${periodLabel(f)} · primary invoices (company → distributor) · outstanding as of ${labelOf(f.to)} month-end`} />
      {sc.outletLevel && <div className="mb-3"><Note tone="warn">Receivables are at distributor level — Salesperson, Beat and Outlet-type filters only narrow the list of distributors.</Note></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Invoice Amount" value={inr(T.invoiced[0])} sub={`${num(T.invoices[0])} invoices`} />
        <KpiCard label="Collections" value={inr(T.collected[0])} sub="received in period" />
        <KpiCard label="Collection %" info="collection_pct" value={pctf(collPct)} tone={collPct >= 90 ? 'good' : collPct >= 80 ? 'warn' : 'serious'} />
        <KpiCard label="Collection Efficiency" info="collection_efficiency" value={pctf(ceiV)} tone={ceiTone(ceiV)} />
        <KpiCard label="Outstanding" info="outstanding" value={inr(T.outstanding[0])} sub={`opening ${inr(T.opening[0])}`} />
        <KpiCard label="Overdue" info="overdue" value={inr(T.overdue[0])} sub={`${pctf((T.overdue[0] / T.outstanding[0]) * 100, 0)} of outstanding`} tone={T.ageing[4][0] > 0 ? 'serious' : 'neutral'} />
        <KpiCard label="Avg Days to Collect" info="days_to_collect" value={Number.isNaN(dtc) ? '—' : `${dtc.toFixed(1)} d`} sub="invoice → payment" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Invoiced vs collected" subtitle="Monthly primary billing (incl. GST) and cash received">
          <ComboChart data={d.trend} series={[{ key: 'invoiced', name: 'Invoiced', color: t.secondary }, { key: 'collected', name: 'Collected', color: t.collected, type: 'line' }]} />
        </Card>
        <Card className="xl:col-span-2" title="Receivables ageing" subtitle="Outstanding by days past due date" info="overdue">
          <ColumnChart height={230} legend={false} data={ageData} series={[{ key: 'value', name: 'Outstanding', color: t.seq[5] }]} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ageData.map((a, i) => <Badge key={a.label} tone={i === 0 ? 'good' : i === 1 ? 'warn' : i === 2 ? 'serious' : 'critical'} icon={false}>{a.label}: {pctf((a.value / (T.outstanding[0] || 1)) * 100, 0)}</Badge>)}
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Collections breakdown" subtitle="Red rows: collection efficiency below 70% or 90+ days overdue exposure"
        actions={<Segmented value={dim} onChange={setDimSel} options={[{ value: 'region', label: 'Region' }, { value: 'state', label: 'State' }, { value: 'distributor', label: 'Distributor' }]} />}>
        <DataTable rows={rows} initialSort="outstanding" pageSize={15} exportName={`collections-${dim}`} onRowClick={r => setDim(dim, [r.k])}
          rowClass={r => (r.cei < 70 || r.od90 > 0 ? 'bg-critical-bg/40' : undefined)} columns={[
            { key: 'name', header: dim[0].toUpperCase() + dim.slice(1), value: r => r.name, render: r => <div className="max-w-[230px]"><p className="truncate font-medium">{r.name}</p>{r.sub && <p className="truncate text-[10.5px] text-muted">{r.sub}</p>}</div> },
            { key: 'invoiced', header: 'Invoiced', align: 'right', value: r => r.invoiced, render: r => inr(r.invoiced) },
            { key: 'collected', header: 'Collected', align: 'right', value: r => r.collected, render: r => inr(r.collected) },
            { key: 'collPct', header: 'Coll. %', align: 'right', value: r => r.collPct, render: r => pctf(r.collPct) },
            { key: 'cei', header: 'CEI', align: 'right', value: r => r.cei, render: r => <Badge tone={ceiTone(r.cei)} icon={false}>{pctf(r.cei)}</Badge> },
            { key: 'outstanding', header: 'Outstanding', align: 'right', value: r => r.outstanding, render: r => inr(r.outstanding) },
            { key: 'overdue', header: 'Overdue', align: 'right', value: r => r.overdue, render: r => inr(r.overdue) },
            { key: 'od90', header: '90+ days', align: 'right', value: r => r.od90, render: r => <span className={r.od90 > 0 ? 'font-semibold text-critical' : 'text-muted'}>{inr(r.od90)}</span> },
            { key: 'days', header: 'Avg days', align: 'right', value: r => r.days, render: r => (Number.isNaN(r.days) ? '—' : r.days.toFixed(1)) },
            { key: 'maxOd', header: 'Max overdue', align: 'right', value: r => r.maxOd, render: r => (r.maxOd ? `${num(r.maxOd)} d` : '—') },
            ...(dim === 'distributor' ? [{ key: 'util', header: 'Credit used', align: 'right' as const, value: (r: typeof rows[number]) => r.util, render: (r: typeof rows[number]) => <span className={r.util > 100 ? 'font-semibold text-critical' : ''}>{pctf(r.util, 0)}</span> }] : []),
          ]} />
      </Card>
    </div>
  )
}
