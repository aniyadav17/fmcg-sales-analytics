import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react'
import { cx, EmptyState } from './ui'

export interface Column<T> {
  key: string
  header: ReactNode
  /** value used for sorting, searching and CSV export */
  value: (r: T) => number | string
  render?: (r: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
  sortable?: boolean
  className?: (r: T) => string | undefined
}

export function DataTable<T>({ rows, columns, initialSort, initialDir = 'desc', pageSize = 10, search = true, onRowClick,
  exportName, dense, rowClass, toolbar, emptyHint, searchPlaceholder = 'Search…' }: {
  rows: T[]; columns: Column<T>[]; initialSort?: string; initialDir?: 'asc' | 'desc'; pageSize?: number; search?: boolean
  onRowClick?: (r: T) => void; exportName?: string; dense?: boolean; rowClass?: (r: T) => string | undefined; toolbar?: ReactNode
  emptyHint?: string; searchPlaceholder?: string
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key?: string; dir: 'asc' | 'desc' }>({ key: initialSort, dir: initialDir })
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(pageSize)

  const filtered = useMemo(() => {
    if (!q.trim() || !rows.length) return rows
    const needle = q.toLowerCase()
    const textCols = columns.filter(c => typeof c.value(rows[0] as T) === 'string')
    return rows.filter(r => textCols.some(c => String(c.value(r)).toLowerCase().includes(needle)))
  }, [rows, q, columns])

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sort.key)
    if (!col) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = col.value(a), vb = col.value(b)
      if (typeof va === 'number' && typeof vb === 'number') {
        const na = Number.isFinite(va) ? va : -Infinity, nb = Number.isFinite(vb) ? vb : -Infinity
        return (na - nb) * dir
      }
      return String(va).localeCompare(String(vb)) * dir
    })
  }, [filtered, sort, columns])

  const pages = Math.max(1, Math.ceil(sorted.length / size))
  const p = Math.min(page, pages - 1)
  const view = sorted.slice(p * size, p * size + size)

  const exportCsv = () => {
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const head = columns.map(c => esc(typeof c.header === 'string' ? c.header : c.key)).join(',')
    const body = sorted.map(r => columns.map(c => { const v = c.value(r); return esc(typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : v) }).join(',')).join('\n')
    const blob = new Blob([head + '\n' + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${exportName ?? 'export'}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-w-0">
      {(search || exportName || toolbar) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {search && (
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => { setQ(e.target.value); setPage(0) }} placeholder={searchPlaceholder}
                className="w-56 rounded-md border border-line bg-surface py-1 pl-7 pr-2 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
            </div>
          )}
          {toolbar}
          <span className="ml-auto text-[11px] text-muted tabular">{sorted.length.toLocaleString('en-IN')} rows</span>
          {exportName && (
            <button onClick={exportCsv} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-surface-2">
              <Download size={12} /> CSV
            </button>
          )}
        </div>
      )}
      <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-surface-2">
            <tr>
              {columns.map(c => {
                const active = sort.key === c.key
                const sortable = c.sortable !== false
                return (
                  <th key={c.key} style={{ width: c.width }}
                    onClick={() => sortable && setSort(s => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                    className={cx('whitespace-nowrap border-b border-line px-2.5 py-2 font-semibold text-ink-2 select-none',
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', sortable && 'cursor-pointer hover:text-ink')}>
                    <span className={cx('inline-flex items-center gap-0.5', c.align === 'right' && 'flex-row-reverse')}>
                      {c.header}
                      {active && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {view.map((r, i) => (
              <tr key={i} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2', rowClass?.(r))}>
                {columns.map(c => (
                  <td key={c.key} className={cx(dense ? 'px-2.5 py-1.5' : 'px-2.5 py-2', 'align-middle text-ink',
                    c.align === 'right' ? 'text-right tabular whitespace-nowrap' : c.align === 'center' ? 'text-center' : 'text-left', c.className?.(r))}>
                    {c.render ? c.render(r) : String(c.value(r))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!view.length && <EmptyState title="No matching rows" hint={emptyHint} />}
      </div>
      {sorted.length > size && (
        <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-muted">
          <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(0) }} className="rounded border border-line bg-surface px-1 py-0.5 text-ink">
            {[10, 25, 50, 100].map(s => <option key={s} value={s}>{s} / page</option>)}
          </select>
          <span className="tabular">{p * size + 1}–{Math.min(sorted.length, (p + 1) * size)} of {sorted.length.toLocaleString('en-IN')}</span>
          <button disabled={p === 0} onClick={() => setPage(p - 1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ChevronLeft size={14} /></button>
          <button disabled={p >= pages - 1} onClick={() => setPage(p + 1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  )
}
