import { useState } from 'react'
import { Search } from 'lucide-react'
import { KPIS } from '../content/kpis'
import { Card, PageHeader, cx } from '../components/ui'

const GLOSSARY: [string, string][] = [
  ['Primary sales', 'Company → distributor billing (sell-in), at distributor price (PTD).'],
  ['Secondary sales', 'Distributor → retailer billing (sell-out), at price to retailer (PTR). The truest measure of market demand in a DMS.'],
  ['Tertiary sales', 'Retailer → consumer. Not captured here (would need retail POS / panel data).'],
  ['MRP / PTR / PTD', 'Maximum Retail Price (incl. GST) → Price to Retailer (MRP less retailer margin, ex-GST) → Price to Distributor (PTR less distributor margin).'],
  ['Beat', 'A fixed route of outlets a salesperson visits on a set weekday.'],
  ['Productive call', 'An outlet visit that results in an order.'],
  ['Lines per call (LPC)', 'Number of different SKUs in an order — measures range selling.'],
  ['Stock norm', 'Days of cover a distributor should hold (7–45 days here). Below = stock-out risk, above = working-capital lock-up.'],
  ['Pipeline loading', 'Pushing primary sales (often at quarter / year end) faster than secondary consumes them, inflating distributor stock.'],
  ['FIFO ageing', 'Closing stock is assumed to be from the latest receipts; older remaining stock is at expiry risk.'],
  ['Credit hold', 'Supply stopped for a distributor that has breached its credit limit or overdue days.'],
  ['SPLY', 'Same period last year — the comparison base for growth %.'],
]

export default function KpiDefinitions() {
  const [q, setQ] = useState('')
  const groups = [...new Set(KPIS.map(k => k.group))]
  const [g, setG] = useState<string>('All')
  const list = KPIS.filter(k => (g === 'All' || k.group === g) && (!q || `${k.name} ${k.definition} ${k.formula}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <div>
      <PageHeader title="KPI Definitions" subtitle="Every metric on the dashboard — definition, formula and how to read it. Hover the ⓘ icons on any card for the same text." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search KPIs…" className="w-64 rounded-md border border-line bg-surface py-1.5 pl-7 pr-2 text-xs focus:border-accent focus:outline-none" />
        </div>
        {['All', ...groups].map(x => (
          <button key={x} onClick={() => setG(x)} className={cx('rounded-full border px-2.5 py-1 text-xs', g === x ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2')}>{x}</button>
        ))}
      </div>
      <div className="scroll-thin overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-left text-ink-2"><tr>
            <th className="px-3 py-2.5 font-semibold">KPI</th><th className="px-3 py-2.5 font-semibold">Definition</th><th className="px-3 py-2.5 font-semibold">Formula</th><th className="px-3 py-2.5 font-semibold">Business interpretation</th>
          </tr></thead>
          <tbody>
            {list.map(k => (
              <tr key={k.id} className="border-t border-line align-top">
                <td className="px-3 py-2.5"><p className="font-semibold text-ink">{k.name}</p><p className="text-[10.5px] text-muted">{k.group}</p></td>
                <td className="max-w-[280px] px-3 py-2.5 text-ink-2">{k.definition}</td>
                <td className="max-w-[260px] px-3 py-2.5"><code className="block rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink">{k.formula}</code></td>
                <td className="max-w-[320px] px-3 py-2.5 text-ink-2">{k.interpretation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card className="mt-4" title="FMCG glossary">
        <dl className="grid gap-x-8 gap-y-2 text-xs md:grid-cols-2">
          {GLOSSARY.map(([a, b]) => <div key={a}><dt className="font-semibold text-ink">{a}</dt><dd className="text-ink-2">{b}</dd></div>)}
        </dl>
      </Card>
    </div>
  )
}
