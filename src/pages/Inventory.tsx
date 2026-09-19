import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { stockSnapshot, stockValueTrend, summarizeStock, bucketOf, STOCK_NORMS, type StockRow, type StockStatus } from '../analytics/stock'
import { labelOf } from '../analytics/views'
import { Badge, Card, KpiCard, PageHeader, Segmented, cx, Note, type Tone } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { ColumnChart, ComboChart, RankBars } from '../charts/Charts'
import { useChartTheme, STATUS } from '../charts/theme'
import { days, inr, num, pctf } from '../utils/format'

export const STATUS_TONE: Record<StockStatus, Tone> = {
  'Stock-out': 'critical', 'Low Stock': 'serious', Healthy: 'good', Overstock: 'warn', 'Slow-moving': 'warn', 'Non-moving': 'warn',
}
const STATUS_COLOR: Record<StockStatus, string> = {
  'Stock-out': STATUS.critical, 'Low Stock': STATUS.serious, Healthy: STATUS.good, Overstock: STATUS.warning, 'Slow-moving': STATUS.warning, 'Non-moving': STATUS.warning,
}
const BUCKETS = [
  { b: 'Stock-out', emoji: '🔴', tone: 'critical' as Tone, color: STATUS.critical, hint: 'zero closing stock' },
  { b: 'Low Stock', emoji: '🟠', tone: 'serious' as Tone, color: STATUS.serious, hint: `< ${STOCK_NORMS.low} days cover` },
  { b: 'Overstock', emoji: '🟡', tone: 'warn' as Tone, color: STATUS.warning, hint: `> ${STOCK_NORMS.over} days, incl. slow & non-moving` },
  { b: 'Healthy', emoji: '🟢', tone: 'good' as Tone, color: STATUS.good, hint: `${STOCK_NORMS.low}–${STOCK_NORMS.over} days cover` },
] as const

export default function Inventory() {
  const ds = useData()
  const { filters: f, scope: sc } = useFilters()
  const t = useChartTheme()
  const month = f.to
  const [status, setStatus] = useState<'all' | 'Excess' | StockStatus>('all')
  const [dist, setDist] = useState<number | null>(null)

  const d = useMemo(() => {
    const rows = stockSnapshot(ds, sc, month)
    const sum = summarizeStock(rows, ds, month)
    const from = Math.max(0, month - 17)
    const trend = stockValueTrend(ds, sc, from, month)
    const tr = []
    for (let m = from; m <= month; m++) tr.push({ label: labelOf(m), stock: trend[m] })
    // distributor roll-up
    const nD = ds.counts.distributor
    const by = Array.from({ length: nD }, () => ({ value: 0, cogs: 0, outs: 0, lines: 0, slow: 0, aged: 0, sales: 0 }))
    const pp = ds.monthPricePeriod[month]
    for (const r of rows) {
      const x = by[r.dist]
      x.value += r.value; x.cogs += (r.sales3m * ds.ptd[r.sku * 6 + pp]) / 91; x.lines++; x.sales += r.salesValue3m
      if (r.status === 'Stock-out') x.outs++
      if (r.status === 'Slow-moving' || r.status === 'Non-moving') x.slow += r.value
      x.aged += r.ageValue[3]
    }
    const distRows = by.map((x, i) => ({ d: i, name: ds.m.distributors.name[i], id: ds.m.distributors.id[i], state: ds.m.states.name[ds.distState[i]], ...x, cover: x.cogs > 0 ? x.value / x.cogs : x.value > 0 ? Infinity : NaN, outPct: x.lines ? (x.outs / x.lines) * 100 : NaN }))
      .filter(x => x.lines > 0)
    const medV = [...distRows].map(x => x.value).sort((a, b) => a - b)[Math.floor(distRows.length / 2)] ?? 0
    const medS = [...distRows].map(x => x.sales).sort((a, b) => a - b)[Math.floor(distRows.length / 2)] ?? 0
    const highLow = distRows.filter(x => x.value > medV && x.sales < medS).sort((a, b) => b.value - a.value)
    return { rows, sum, tr, distRows, highLow }
  }, [ds, sc, month])

  const bucketStats = BUCKETS.map(b => {
    const rs = d.rows.filter(r => bucketOf(r.status) === b.b)
    return { ...b, count: rs.length, value: rs.reduce((a, r) => a + r.value, 0), salesAtRisk: rs.reduce((a, r) => a + r.salesValue3m / 3, 0) }
  })
  const tableRows = d.rows.filter(r => (status === 'all' || r.status === status || (status === 'Excess' && bucketOf(r.status) === 'Overstock')) && (dist === null || r.dist === dist))
  const S = d.sum
  const risk = S.valueByStatus['Slow-moving'] + S.valueByStatus['Non-moving']

  return (
    <div>
      <PageHeader title="Inventory & Stock Analytics" subtitle={`Distributor stock snapshot at ${labelOf(month)} month-end (period end) · cover based on the last 3 months' secondary sales · valued at distributor price`} />
      {sc.outletLevel && <div className="mb-3"><Note tone="warn">Stock is held by distributors — Salesperson, Beat and Outlet-type filters only narrow the list of distributors.</Note></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Stock Value" info="stock_value" value={inr(S.value)} sub={`${num(S.units)} units · ${num(S.combos)} dist-SKU lines`} />
        <KpiCard label="Stock Cover" info="stock_cover" value={days(S.coverDays)} tone={S.coverDays > STOCK_NORMS.over ? 'warn' : S.coverDays < STOCK_NORMS.low ? 'serious' : 'good'} sub={`norm ${STOCK_NORMS.low}–${STOCK_NORMS.over} days`} />
        <KpiCard label="Stock-out %" info="stockout_pct" value={pctf(S.stockOutPct)} tone={S.stockOutPct > 5 ? 'critical' : 'good'} sub={`${num(S.stockOuts)} distributor-SKU lines`} />
        <KpiCard label="Slow / non-moving" info="stock_cover" value={inr(risk)} sub={`${pctf(risk / S.value * 100, 0)} of stock value`} tone={risk / S.value > 0.2 ? 'serious' : 'warn'} />
        <KpiCard label="Aged > 90 days" info="ageing" value={inr(S.ageValue[3])} sub={`${pctf(S.ageValue[3] / S.value * 100, 0)} of stock value`} tone={S.ageValue[3] / S.value > 0.15 ? 'serious' : 'neutral'} />
        <KpiCard label="High stock · Low sales" value={num(d.highLow.length)} sub="distributors (above-median stock, below-median sales)" tone={d.highLow.length ? 'serious' : 'good'} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {bucketStats.map(b => (
          <button key={b.b} onClick={() => setStatus(b.b === 'Overstock' ? 'Excess' : (b.b as StockStatus))}
            className={cx('rounded-xl border bg-surface p-3 text-left transition-colors hover:border-line-strong', (status === b.b || (status === 'Excess' && b.b === 'Overstock')) ? 'border-accent' : 'border-line')}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">{b.emoji} {b.b}</span>
              <Badge tone={b.tone} icon={false}>{pctf((b.count / Math.max(1, d.rows.length)) * 100, 0)} of lines</Badge>
            </div>
            <p className="mt-1.5 text-lg font-semibold text-ink tabular">{num(b.count)} <span className="text-xs font-normal text-muted">lines · {inr(b.value)}</span></p>
            <p className="text-[11px] text-muted">{b.hint}{b.b === 'Stock-out' || b.b === 'Low Stock' ? ` · ${inr(b.salesAtRisk)}/month sales at risk` : ''}</p>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Stock value by health status" info="stock_cover">
          <RankBars height={230} labelWidth={96} data={(['Stock-out', 'Low Stock', 'Healthy', 'Overstock', 'Slow-moving', 'Non-moving'] as StockStatus[]).map(s => ({ name: s, value: S.valueByStatus[s], sub: `${num(S.countByStatus[s])} distributor-SKU lines`, color: STATUS_COLOR[s] }))} />
          <p className="mt-1 text-[11px] text-muted">Status colours: 🔴 stock-out · 🟠 low · 🟢 healthy · 🟡 overstock / slow / non-moving</p>
        </Card>
        <Card title="Stock ageing (FIFO)" subtitle="Value by days since receipt" info="ageing">
          <ColumnChart height={230} legend={false} data={['0-30d', '31-60d', '61-90d', '90+d'].map((l, i) => ({ label: l, value: S.ageValue[i] }))}
            series={[{ key: 'value', name: 'Stock value', color: t.seq[4] }]} />
        </Card>
        <Card title="Stock value trend" subtitle="Month-end distributor stock, last 18 months" info="stock_value">
          <ComboChart height={230} data={d.tr} series={[{ key: 'stock', name: 'Stock value', color: t.stock }]} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2" title="🟡 High stock + low sales" subtitle="Distributors with above-median stock and below-median sales — cash stuck in the pipeline" info="stock_cover">
          <DataTable rows={d.highLow} initialSort="value" pageSize={8} search={false} onRowClick={r => setDist(r.d)} columns={[
            { key: 'name', header: 'Distributor', value: r => r.name, render: r => <div className="max-w-[170px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{r.state}</p></div> },
            { key: 'value', header: 'Stock', align: 'right', value: r => r.value, render: r => inr(r.value) },
            { key: 'sales', header: '3m sales', align: 'right', value: r => r.sales, render: r => inr(r.sales) },
            { key: 'cover', header: 'Cover', align: 'right', value: r => r.cover, render: r => <Badge tone="warn" icon={false}>{days(r.cover)}</Badge> },
          ]} />
        </Card>
        <Card className="xl:col-span-3" title="Stock by distributor" subtitle="Click a distributor to see why its stock is high (SKU & ageing breakdown)">
          <DataTable rows={d.distRows} initialSort="value" pageSize={8} exportName="distributor-stock" onRowClick={r => setDist(r.d)}
            rowClass={r => (r.d === dist ? 'bg-accent-soft' : undefined)} columns={[
              { key: 'name', header: 'Distributor', value: r => r.name, render: r => <div className="max-w-[180px]"><p className="truncate font-medium">{r.name}</p><p className="truncate text-[10.5px] text-muted">{r.id} · {r.state}</p></div> },
              { key: 'value', header: 'Stock value', align: 'right', value: r => r.value, render: r => inr(r.value) },
              { key: 'cover', header: 'Cover', align: 'right', value: r => r.cover, render: r => <Badge tone={r.cover > 90 ? 'critical' : r.cover > 45 ? 'warn' : r.cover < 7 ? 'serious' : 'good'} icon={false}>{days(r.cover)}</Badge> },
              { key: 'outPct', header: 'Stock-out %', align: 'right', value: r => r.outPct, render: r => <span className={r.outPct > 10 ? 'font-semibold text-critical' : ''}>{pctf(r.outPct, 0)}</span> },
              { key: 'slow', header: 'Slow/non-moving', align: 'right', value: r => r.slow, render: r => inr(r.slow) },
              { key: 'aged', header: 'Aged 90+', align: 'right', value: r => r.aged, render: r => inr(r.aged) },
            ]} />
        </Card>
      </div>

      <Card className="mt-4" title={dist === null ? 'Distributor × SKU stock detail' : `Why is stock high at ${ds.m.distributors.name[dist]}?`}
        subtitle={dist === null ? 'Every distributor-SKU line at the snapshot' : 'SKU-level stock, sales, cover and ageing for the selected distributor'}
        actions={<div className="flex flex-wrap items-center gap-2">
          {dist !== null && <button onClick={() => setDist(null)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2"><X size={12} />All distributors</button>}
          <Segmented size="xs" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'Excess', label: 'All excess' }, ...(['Stock-out', 'Low Stock', 'Healthy', 'Overstock', 'Slow-moving', 'Non-moving'] as StockStatus[]).map(s => ({ value: s, label: s }))]} />
        </div>}>
        {dist !== null && <DistributorAgeing rows={d.rows.filter(r => r.dist === dist)} />}
        <DataTable rows={tableRows} initialSort="value" pageSize={12} exportName="stock-detail" searchPlaceholder="Search SKU or distributor…" columns={[
          { key: 'dist', header: 'Distributor', value: r => ds.m.distributors.name[r.dist], render: r => <span className="block max-w-[160px] truncate">{ds.m.distributors.name[r.dist]}</span> },
          { key: 'sku', header: 'SKU', value: r => ds.m.skus.name[r.sku], render: r => <div className="max-w-[220px]"><p className="truncate font-medium">{ds.m.skus.name[r.sku]}</p><p className="truncate text-[10.5px] text-muted">{ds.m.skus.code[r.sku]} · {ds.m.skus.status[r.sku]}</p></div> },
          { key: 'closing', header: 'Closing units', align: 'right', value: r => r.closing, render: r => num(r.closing) },
          { key: 'value', header: 'Stock value', align: 'right', value: r => r.value, render: r => inr(r.value) },
          { key: 'sales3m', header: '3m sales (units)', align: 'right', value: r => r.sales3m, render: r => num(r.sales3m) },
          { key: 'dos', header: 'Days of stock', align: 'right', value: r => r.dos, render: r => days(r.dos) },
          { key: 'status', header: 'Status', value: r => r.status, render: r => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
          { key: 'aged', header: 'Aged 90+', align: 'right', value: r => r.ageValue[3], render: r => inr(r.ageValue[3]) },
        ]} />
      </Card>
    </div>
  )
}

function DistributorAgeing({ rows }: { rows: StockRow[] }) {
  const t = useChartTheme()
  const tot = rows.reduce((a, r) => a + r.value, 0)
  const ages = [0, 1, 2, 3].map(i => rows.reduce((a, r) => a + r.ageValue[i], 0))
  const top = [...rows].sort((a, b) => b.value - a.value).slice(0, 5)
  const topShare = top.reduce((a, r) => a + r.value, 0) / (tot || 1)
  const slow = rows.filter(r => r.status === 'Slow-moving' || r.status === 'Non-moving').reduce((a, r) => a + r.value, 0)
  return (
    <div className="mb-4 grid gap-4 md:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-medium text-ink-2">Ageing of {inr(tot)} stock</p>
        <ColumnChart height={170} legend={false} data={['0-30', '31-60', '61-90', '90+'].map((l, i) => ({ label: `${l}d`, value: ages[i] }))} series={[{ key: 'value', name: 'Stock value', color: t.seq[4] }]} />
      </div>
      <ul className="space-y-1.5 self-center text-xs text-ink-2">
        <li>• Top 5 SKUs hold <b className="text-ink">{pctf(topShare * 100, 0)}</b> of this distributor's stock value.</li>
        <li>• <b className="text-ink">{inr(slow)}</b> ({pctf((slow / (tot || 1)) * 100, 0)}) is slow- or non-moving (&gt;{STOCK_NORMS.slow} days cover or no sales in 3 months).</li>
        <li>• <b className="text-ink">{inr(ages[3])}</b> is older than 90 days — candidates for liquidation schemes or inter-distributor transfer.</li>
        <li>• Action: stop further primary on SKUs above {STOCK_NORMS.over} days cover until stock normalises.</li>
      </ul>
    </div>
  )
}
