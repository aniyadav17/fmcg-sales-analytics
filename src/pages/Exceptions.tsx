import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, Boxes, IndianRupee, Rocket, TrendingDown } from 'lucide-react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { periodLabel } from '../state/filters'
import { detectExceptions, RULES, type ExcCategory, type Exception, type Severity } from '../analytics/exceptions'
import { labelOf } from '../analytics/views'
import { Badge, Card, PageHeader, Segmented, cx, Note, type Tone } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { DrillExplorer, type DrillStep } from '../components/DrillExplorer'
import { inr, num } from '../utils/format'

const SEV_TONE: Record<Severity, Tone> = { High: 'critical', Medium: 'serious', Low: 'warn' }
const CATS: { c: ExcCategory; icon: ReactNode; label: string; hint: string }[] = [
  { c: 'Sales', icon: <TrendingDown size={16} />, label: 'Sales exceptions', hint: 'Under-achievement, declines, low productivity' },
  { c: 'Stock', icon: <Boxes size={16} />, label: 'Stock exceptions', hint: 'Stock-outs, excess, high stock + low sales' },
  { c: 'Collection', icon: <IndianRupee size={16} />, label: 'Collection exceptions', hint: 'Overdue amount & days, low efficiency' },
  { c: 'Opportunity', icon: <Rocket size={16} />, label: 'Opportunities', hint: 'Growth pockets to invest in' },
]

export default function Exceptions() {
  const ds = useData()
  const { filters: f, scope: sc } = useFilters()
  const [cat, setCat] = useState<ExcCategory>('Sales')
  const [focus, setFocus] = useState<DrillStep[] | null>(null)
  const all = useMemo(() => detectExceptions(ds, sc, f), [ds, sc, f])

  const byCat = (c: ExcCategory) => all.filter(e => e.category === c)
  const risks = all.filter(e => e.category !== 'Opportunity')
  const priorities = [...risks].sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || b.impact - a.impact).slice(0, 8)
  const rows = byCat(cat)
  const ruleCounts = Object.entries(rows.reduce<Record<string, number>>((a, e) => { a[e.rule] = (a[e.rule] ?? 0) + 1; return a }, {})).sort((a, b) => b[1] - a[1])
  const [rule, setRule] = useState<string>('all')
  const shown = rule === 'all' ? rows : rows.filter(r => r.rule === rule)

  const focusOn = (e: Exception) => {
    if (!e.drill) return
    const d = e.drill
    if (d.level === 'distributor' || d.level === 'salesperson' || d.level === 'state' || d.level === 'region' || d.level === 'outlet') setFocus([{ level: d.level, k: d.k, name: d.name }])
    setTimeout(() => document.getElementById('attention')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  return (
    <div>
      <PageHeader title="Exception & Opportunity Center" subtitle={`Where should management take action? · ${periodLabel(f)} · stock & receivables as of ${labelOf(f.to)} month-end`} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {CATS.map(c => {
          const list = byCat(c.c)
          const high = list.filter(e => e.severity === 'High').length
          return (
            <button key={c.c} onClick={() => { setCat(c.c); setRule('all') }} className={cx('rounded-xl border bg-surface p-3.5 text-left hover:border-line-strong', cat === c.c ? 'border-accent ring-1 ring-accent' : 'border-line')}>
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className={cx('flex items-center gap-2 text-sm font-semibold', c.c === 'Opportunity' ? 'text-good' : 'text-ink')}>{c.icon}{c.label}</span>
                {high > 0 && <Badge tone={c.c === 'Opportunity' ? 'good' : 'critical'}>{high} high</Badge>}
              </div>
              <p className="mt-2 text-2xl font-semibold text-ink tabular">{num(list.length)}</p>
              <p className="text-[11px] text-muted">{c.hint}</p>
              <p className="mt-1 text-xs text-ink-2">{c.c === 'Opportunity' ? 'Upside' : 'At stake'}: <b className="tabular">{inr(list.reduce((a, e) => a + Math.max(0, e.impact), 0))}</b></p>
            </button>
          )
        })}
      </div>

      <Card className="mt-4" title="Top priorities for management" subtitle="Highest-severity risks ranked by ₹ at stake — click to see who needs attention">
        {priorities.length ? (
          <ol className="divide-y divide-line">
            {priorities.map((e, i) => (
              <li key={e.id} onClick={() => focusOn(e)} className={cx('flex items-start gap-3 py-2.5', e.drill && 'cursor-pointer hover:bg-surface-2')}>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-ink-2">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink"><b className="font-semibold">{e.entity}</b> <span className="text-muted">· {e.entityType} · {e.context}</span></p>
                  <p className="text-xs text-ink-2">{e.rule}: {e.metric}</p>
                  <p className="mt-0.5 text-xs text-accent">→ {e.action}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone={SEV_TONE[e.severity]}>{e.severity}</Badge>
                  <p className="mt-1 text-xs font-medium text-ink tabular">{inr(e.impact)}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : <Note tone="good">No high-severity exceptions for the current filters.</Note>}
      </Card>

      <Card className="mt-4" title={`${CATS.find(c => c.c === cat)!.label} (${rows.length})`} subtitle="Rule-based detection; thresholds are listed below. Click a row with a drill target to investigate."
        actions={<Segmented size="xs" value={cat} onChange={v => { setCat(v); setRule('all') }} options={CATS.map(c => ({ value: c.c, label: c.c }))} />}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button onClick={() => setRule('all')} className={cx('rounded-full border px-2.5 py-0.5 text-[11px]', rule === 'all' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2')}>All rules ({rows.length})</button>
          {ruleCounts.map(([r, n]) => (
            <button key={r} onClick={() => setRule(r)} className={cx('rounded-full border px-2.5 py-0.5 text-[11px]', rule === r ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2')}>{r} ({n})</button>
          ))}
        </div>
        <DataTable rows={shown} initialSort="impact" pageSize={12} exportName={`exceptions-${cat.toLowerCase()}`} onRowClick={focusOn} columns={[
          { key: 'severity', header: 'Severity', value: e => sevRank(e.severity), render: e => <Badge tone={cat === 'Opportunity' ? 'good' : SEV_TONE[e.severity]}>{e.severity}</Badge>, width: '90px' },
          { key: 'entity', header: 'Who / what', value: e => e.entity, render: e => <div className="max-w-[260px]"><p className="truncate font-medium">{e.entity}</p><p className="truncate text-[10.5px] text-muted">{e.entityType} · {e.context}</p></div> },
          { key: 'rule', header: 'Rule', value: e => e.rule, render: e => <span className="block max-w-[200px] truncate text-ink-2">{e.rule}</span> },
          { key: 'metric', header: 'Evidence', value: e => e.metric, render: e => <span className="block max-w-[240px] truncate">{e.metric}</span> },
          { key: 'impact', header: cat === 'Opportunity' ? 'Upside' : '₹ at stake', align: 'right', value: e => e.impact, render: e => (e.impact ? inr(e.impact) : '—') },
          { key: 'action', header: 'Recommended action', value: e => e.action, render: e => <span className="block max-w-[280px] text-[11.5px] text-ink-2">{e.action}</span> },
          { key: 'go', header: '', sortable: false, value: () => '', render: e => (e.drill ? <ArrowRight size={14} className="text-accent" /> : null), width: '24px' },
        ]} />
      </Card>

      <Card className="mt-4" title="Who needs attention?" subtitle="Distributor → Salesperson → Beat → Outlet → SKU, compared with last year. Pick an exception above to start from it.">
        <div id="attention" />
        {focus ? <DrillExplorer initialPath={focus} /> : <DrillExplorer startLabel="All India (pick an exception to focus)" />}
      </Card>

      <Card className="mt-4" title="Exception rules & thresholds">
        <ul className="grid gap-x-6 gap-y-1 text-xs text-ink-2 md:grid-cols-2">
          <li>• Target achievement &lt; {RULES.achLow}% (High &lt; {RULES.achVeryLow}%)</li>
          <li>• Net secondary declining {RULES.declineMonths} consecutive months, ≥ {RULES.declineMinPct}% total drop</li>
          <li>• Last month &lt; {RULES.belowAvgPct}% of the previous 6-month average</li>
          <li>• Salesperson outlet productivity &lt; {RULES.productivityLow}% (monthly average)</li>
          <li>• Stock-out on a SKU selling &gt; ₹15K/month; low stock (&lt; {RULES.lowStockDays} days) on &gt; ₹40K/month</li>
          <li>• Excess stock &gt; {RULES.slowDays} days cover; high stock + low sales vs network medians</li>
          <li>• Overdue &gt; {RULES.overduePctOfLimit}% of credit limit; oldest invoice &gt; {RULES.overdueDays} days past due; CEI &lt; {RULES.ceiLow}%</li>
          <li>• Opportunities: SKU growth &gt; {RULES.skuGrowth}%, state growth &gt; company + {RULES.regionGrowthPremium} pts, salesperson ach &gt; {RULES.spTopAch}%, secondary growth &gt; {RULES.strongSecGrowth}% with &lt; {RULES.thinCover} days cover, outlet orders ×{RULES.freqUplift}</li>
        </ul>
      </Card>
    </div>
  )
}

const sevRank = (s: Severity) => (s === 'High' ? 3 : s === 'Medium' ? 2 : 1)
