import { useData } from '../state/DataContext'
import { Card, PageHeader } from '../components/ui'
import { num } from '../utils/format'

interface T { name: string; kind: 'fact' | 'dim'; grain: string; keys: string; rows?: number; note?: string }

export default function DataModel() {
  const ds = useData()
  const rc = ds.manifest.rawRowCounts
  const c = ds.counts
  const facts: T[] = [
    { name: 'sales_transactions', kind: 'fact', grain: 'Invoice line (invoice × SKU); Sales_Type = Primary / Secondary / Sales Return', keys: 'Distributor_ID, Salesperson_ID, Beat_ID, Outlet_ID, SKU_ID, Transaction_Date', rows: rc.sales_transactions },
    { name: 'sales_targets', kind: 'fact', grain: 'Month × Salesperson × Category (SKU via sku_target_mix)', keys: 'Salesperson_ID → Distributor → Territory → State → Region', rows: rc.sales_targets },
    { name: 'distributor_stock', kind: 'fact', grain: 'Month-end snapshot × Distributor × SKU (roll-forward + FIFO ageing)', keys: 'Distributor_ID, SKU_ID, Snapshot_Date', rows: rc.distributor_stock },
    { name: 'collections', kind: 'fact', grain: 'Payment against a primary invoice (one row per payment / open balance)', keys: 'Distributor_ID, Invoice_No', rows: rc.collections },
  ]
  const dims: T[] = [
    { name: 'dim_geography', kind: 'dim', grain: 'Country › Region › State › Territory › City', keys: 'Territory_ID', rows: c.territory, note: `${c.region} regions · ${c.state} states` },
    { name: 'distributor_master', kind: 'dim', grain: 'Distributor', keys: 'Distributor_ID → Territory_ID', rows: c.distributor },
    { name: 'salesperson_master', kind: 'dim', grain: 'Salesperson', keys: 'Salesperson_ID → Distributor_ID', rows: c.salesperson },
    { name: 'beat_master', kind: 'dim', grain: 'Beat (route)', keys: 'Beat_ID → Salesperson_ID', rows: c.beat },
    { name: 'outlet_master', kind: 'dim', grain: 'Retail outlet', keys: 'Outlet_ID → Beat_ID', rows: c.outlet },
    { name: 'product_master', kind: 'dim', grain: 'SKU › Brand › Sub-category › Category', keys: 'SKU_ID', rows: c.sku },
    { name: 'price_list', kind: 'dim', grain: 'SKU × price period (FY)', keys: 'SKU_ID, Price_Period', rows: c.sku * 6 },
  ]
  return (
    <div>
      <PageHeader title="Data Model" subtitle="Star schema: four fact tables sharing conformed dimensions — the same model you would build in Power BI or a SQL warehouse" />
      <Card title="Entity relationships">
        <div className="grid items-center gap-4 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
          <div className="space-y-2">
            {['Region', 'State', 'Territory', 'Distributor', 'Salesperson', 'Beat', 'Outlet'].map((x, i, a) => (
              <div key={x} className="flex flex-col items-center">
                <div className="w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-center text-xs font-medium text-ink">{x}</div>
                {i < a.length - 1 && <span className="text-[10px] leading-3 text-muted">1 : N ↓</span>}
              </div>
            ))}
          </div>
          <div className="hidden text-center text-xs text-muted lg:block">→</div>
          <div className="space-y-2">
            {facts.map(f => (
              <div key={f.name} className="rounded-lg border-2 border-accent/60 bg-accent-soft px-3 py-2 text-xs">
                <p className="font-semibold text-accent">{f.name}</p>
                <p className="text-ink-2">{f.grain}</p>
                <p className="mt-0.5 text-[10.5px] text-muted">{num(f.rows ?? NaN)} rows</p>
              </div>
            ))}
          </div>
          <div className="hidden text-center text-xs text-muted lg:block">←</div>
          <div className="space-y-2">
            {['Category', 'Sub-category', 'Brand', 'SKU', 'Price list (by FY)', 'Calendar (Month / FY)'].map((x, i) => (
              <div key={x} className="flex flex-col items-center">
                <div className="w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-center text-xs font-medium text-ink">{x}</div>
                {i < 3 && <span className="text-[10px] leading-3 text-muted">1 : N ↓</span>}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-ink-2">Sales lines join the network hierarchy through <b>Outlet_ID</b> (secondary / returns) or <b>Distributor_ID</b> (primary). Targets join at salesperson × category; stock and collections at distributor. Every fact joins product and calendar.</p>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {[['Fact tables', facts], ['Dimension tables', dims]].map(([title, list]) => (
          <Card key={title as string} title={title as string}>
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-xs">
              <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Table</th><th className="py-1 font-medium">Grain</th><th className="py-1 font-medium">Keys</th><th className="py-1 text-right font-medium">Rows</th></tr></thead>
              <tbody>{(list as T[]).map(t => (
                <tr key={t.name} className="border-t border-line align-top">
                  <td className="py-2 pr-2 font-mono text-[11px] font-semibold text-ink">{t.name}</td>
                  <td className="py-2 pr-2 text-ink-2">{t.grain}{t.note ? <span className="block text-muted">{t.note}</span> : null}</td>
                  <td className="py-2 pr-2 text-ink-2">{t.keys}</td>
                  <td className="py-2 text-right tabular">{num(t.rows ?? NaN)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
        ))}
      </div>

      <Card className="mt-4" title="How the browser handles 1M+ rows">
        <ul className="grid gap-x-6 gap-y-1.5 text-xs text-ink-2 md:grid-cols-2">
          <li>• The ETL publishes each fact as <b>column-major typed arrays</b> (Uint16 / Int32 …), gzip-compressed: ~1M sales lines ≈ 4 MB.</li>
          <li>• Money is not stored per row: <b>Net = Qty × Price(SKU, FY) × (1 − discount)</b> is derived on load and reconciled with the raw file.</li>
          <li>• Rows are sorted by date, so any period is a <b>contiguous slice</b> (month → row offset index).</li>
          <li>• Filters compile to <b>member masks</b> (per SKU / outlet / distributor) — each row test is an O(1) lookup.</li>
          <li>• Aggregations are memoised per filter state; pages and heavy views are <b>lazy-loaded</b>.</li>
          <li>• The <code>DataSource</code> interface isolates storage: swap static files for a SQL Server / Azure API without touching the pages.</li>
        </ul>
      </Card>
    </div>
  )
}
