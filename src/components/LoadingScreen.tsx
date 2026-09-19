import { Database, TriangleAlert } from 'lucide-react'

export function LoadingScreen({ done, total, label, error }: { done: number; total: number; label: string; error?: string | null }) {
  const pct = Math.round((done / total) * 100)
  return (
    <div className="flex h-full items-center justify-center bg-page p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 shadow-sm">
        <div className="flex items-center gap-3">
          <img src="./favicon.svg" alt="" className="h-9 w-9" />
          <div>
            <h1 className="font-semibold text-ink">FMCG Sales Analytics</h1>
            <p className="text-xs text-muted">Distribution intelligence dashboard</p>
          </div>
        </div>
        {error ? (
          <div className="mt-6 rounded-lg bg-critical-bg p-3 text-sm text-critical">
            <p className="flex items-center gap-2 font-semibold"><TriangleAlert size={16} /> Could not load the dataset</p>
            <p className="mt-1 text-xs">{error}</p>
            <p className="mt-2 text-xs text-ink-2">If you are running locally, generate the data first: <code className="rounded bg-surface px-1">python data/generate_data.py</code></p>
          </div>
        ) : (
          <>
            <div className="mt-6 flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-1.5"><Database size={13} /> Loading {label}…</span>
              <span className="tabular">{pct}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-surface-3">
              <div className="h-1.5 rounded-full bg-accent transition-all" style={{ width: `${Math.max(6, pct)}%` }} />
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-muted">
              Downloading ~1M transaction lines as compressed columnar arrays (~5 MB). All KPIs are then computed in your browser.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
