import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileInput, ShieldCheck, Wrench, Upload } from 'lucide-react'
import { StaticFileSource } from '../data/loader'
import type { DQReport } from '../data/types'
import { Badge, Card, KpiCard, PageHeader, Skeleton, Note, cx } from '../components/ui'
import { RankBars } from '../charts/Charts'
import { useChartTheme } from '../charts/theme'
import { inr, num, pctf } from '../utils/format'

export default function DataQuality() {
  const t = useChartTheme()
  const [r, setR] = useState<DQReport | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    new StaticFileSource(import.meta.env.BASE_URL + 'data/').loadDataQuality().then(setR).catch(e => setErr(String(e.message ?? e)))
  }, [])
  if (err) return <Note tone="critical">Could not load the data-quality report: {err}</Note>
  if (!r) return <div className="space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-28" /><Skeleton className="h-80" /></div>

  const failing = r.checks.filter(c => c.count > 0)
  return (
    <div>
      <PageHeader title="Data Quality" subtitle={`Validation run of the ETL layer (data/build_dataset.py) · ${r.generatedAt.replace('T', ' ')}`} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiCard label="Total Records" value={num(r.totalRecords)} sub="all raw tables" />
        <KpiCard label="Valid Records" value={num(r.validRecords)} sub="after quarantine" />
        <KpiCard label="Exception Records" value={num(r.exceptionRecords)} sub="repaired or quarantined" tone="warn" />
        <KpiCard label="Data Quality %" info="dq_pct" value={pctf(r.dqPct, 2)} tone={r.dqPct >= 99.5 ? 'good' : 'warn'} />
        <KpiCard label="Checks passed" value={`${r.checks.length - failing.length} / ${r.checks.length}`} sub={`${failing.length} with findings`} />
      </div>

      <Card className="mt-4" title="Pipeline">
        <div className="grid gap-3 text-xs md:grid-cols-4">
          {[
            [<FileInput size={16} />, '1. Raw extracts', 'DMS / ERP style CSV exports in data/raw (sales, stock, targets, collections, masters).'],
            [<ShieldCheck size={16} />, '2. Validate', `${r.checks.length} rules: keys, referential integrity, dates, signs, amounts, roll-forward, duplicates.`],
            [<Wrench size={16} />, '3. Repair / quarantine', 'Repairable records are fixed (e.g. distributor from outlet master); the rest are quarantined, never silently dropped.'],
            [<Upload size={16} />, '4. Publish', 'Clean columnar bundles for the dashboard + CSV summaries for BI tools; totals reconciled.'],
          ].map(([icon, title, body], i) => (
            <div key={i} className="rounded-lg bg-surface-2 p-3">
              <p className="flex items-center gap-2 font-semibold text-ink"><span className="text-accent">{icon}</span>{title}</p>
              <p className="mt-1 text-ink-2">{body}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Quality by table">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Table</th><th className="py-1 text-right font-medium">Records</th><th className="py-1 text-right font-medium">Exceptions</th><th className="py-1 text-right font-medium">DQ %</th></tr></thead>
            <tbody>{r.tables.map(x => (
              <tr key={x.table} className="border-t border-line"><td className="py-2 font-medium">{x.table}</td><td className="py-2 text-right tabular">{num(x.total)}</td><td className="py-2 text-right tabular">{num(x.exceptions)}</td>
                <td className="py-2 text-right"><Badge tone={x.dqPct >= 99.5 ? 'good' : 'warn'} icon={false}>{pctf(x.dqPct, 2)}</Badge></td></tr>
            ))}</tbody>
          </table>
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-xs">
            <p className="font-semibold text-ink">Reconciliation</p>
            <p className="mt-1 text-ink-2">Net sales in the raw file vs. recomputed by the dashboard (qty × price list × (1 − discount)):</p>
            <p className="mt-1 tabular text-ink">{inr(r.reconciliation.raw_net)} vs {inr(r.reconciliation.recomputed_net)}</p>
            <p className="text-ink-2">Max row difference ₹{r.reconciliation.max_abs_diff} · rows off by &gt; ₹1: <b>{r.reconciliation.rows_diff_gt_1}</b></p>
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Exceptions by check">
          <RankBars data={failing.sort((a, b) => b.count - a.count).map(c => ({ name: c.check, value: c.count, sub: `${c.table} · ${c.action}` }))} fmt={num} color={t.series[1]} labelWidth={230} />
        </Card>
      </div>

      <Card className="mt-4" title="Validation rules" subtitle="Click a rule with findings to see sample exception records">
        <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-left text-ink-2"><tr>
              {['', 'ID', 'Table', 'Check', 'Rule', 'Severity', 'Records', '%', 'Status', 'Action taken'].map(h => <th key={h} className="whitespace-nowrap px-2.5 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {r.checks.map(c => (
                <Fragment key={c.id}>
                  <tr onClick={() => c.count && setOpen(open === c.id ? null : c.id)} className={cx('border-t border-line', c.count > 0 && 'cursor-pointer hover:bg-surface-2')}>
                    <td className="px-2 text-muted">{c.count > 0 ? (open === c.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}</td>
                    <td className="px-2.5 py-2 font-mono text-[11px] text-muted">{c.id}</td>
                    <td className="px-2.5 py-2">{c.table}</td>
                    <td className="px-2.5 py-2 font-medium">{c.check}</td>
                    <td className="px-2.5 py-2 text-ink-2">{c.rule}</td>
                    <td className="px-2.5 py-2">{c.severity}</td>
                    <td className="px-2.5 py-2 text-right tabular">{num(c.count)}</td>
                    <td className="px-2.5 py-2 text-right tabular">{c.pct.toFixed(3)}</td>
                    <td className="px-2.5 py-2"><Badge tone={c.status === 'Pass' ? 'good' : c.status === 'Warn' ? 'warn' : 'critical'}>{c.status}</Badge></td>
                    <td className="px-2.5 py-2 text-ink-2">{c.action}</td>
                  </tr>
                  {open === c.id && c.sample.length > 0 && (
                    <tr className="bg-surface-2"><td colSpan={10} className="px-3 py-2">
                      <div className="scroll-thin overflow-x-auto">
                        <table className="text-[11px]">
                          <thead><tr>{Object.keys(c.sample[0]).map(k => <th key={k} className="px-2 py-1 text-left font-semibold text-muted">{k}</th>)}</tr></thead>
                          <tbody>{c.sample.map((row, i) => <tr key={i}>{Object.values(row).map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-0.5 font-mono">{v === '' ? <span className="text-critical">∅ blank</span> : v}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">Full exception lists are written to data/processed/quarantined_records.csv on every run.</p>
      </Card>
    </div>
  )
}
