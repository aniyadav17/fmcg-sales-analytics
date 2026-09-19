import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cx } from './ui'

export interface Option { value: number; label: string; hint?: string }

const MAX_VISIBLE = 250

export function MultiSelect({ label, options, value, onChange, placeholder = 'All' }: {
  label: string; options: Option[]; value: number[]; onChange: (v: number[]) => void; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])

  const selected = useMemo(() => new Set(value), [value])
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? options.filter(o => o.label.toLowerCase().includes(n) || o.hint?.toLowerCase().includes(n)) : options
  }, [options, q])
  const shown = matches.slice(0, MAX_VISIBLE)
  const toggle = (v: number) => onChange(selected.has(v) ? value.filter(x => x !== v) : [...value, v])
  const summary = value.length === 0 ? placeholder : value.length === 1 ? options.find(o => o.value === value[0])?.label ?? '1 selected' : `${value.length} selected`

  return (
    <div ref={ref} className="relative min-w-0">
      <span className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={cx('flex w-full items-center justify-between gap-1 rounded-md border bg-surface px-2 py-1.5 text-left text-xs',
          value.length ? 'border-accent text-ink' : 'border-line text-ink-2', 'hover:border-line-strong')}>
        <span className="truncate">{summary}</span>
        {value.length ? (
          <X size={13} className="shrink-0 text-muted hover:text-ink" onClick={e => { e.stopPropagation(); onChange([]) }} />
        ) : <ChevronDown size={13} className="shrink-0 text-muted" />}
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 max-w-[85vw] rounded-lg border border-line bg-surface shadow-xl">
          <div className="border-b border-line p-2">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`}
                className="w-full rounded-md border border-line bg-surface-2 py-1 pl-7 pr-2 text-xs text-ink focus:border-accent focus:outline-none" />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px]">
              <button className="text-accent hover:underline" onClick={() => onChange(Array.from(new Set([...value, ...matches.map(m => m.value)])))}>Select {q ? 'matches' : 'all'} ({matches.length})</button>
              <button className="text-muted hover:text-ink" onClick={() => onChange([])}>Clear</button>
            </div>
          </div>
          <ul className="scroll-thin max-h-64 overflow-y-auto py-1">
            {shown.map(o => (
              <li key={o.value}>
                <button type="button" onClick={() => toggle(o.value)} className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-2">
                  <span className={cx('mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border', selected.has(o.value) ? 'border-accent bg-accent text-white' : 'border-line-strong')}>
                    {selected.has(o.value) && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{o.label}</span>
                    {o.hint && <span className="block truncate text-[10.5px] text-muted">{o.hint}</span>}
                  </span>
                </button>
              </li>
            ))}
            {matches.length > MAX_VISIBLE && <li className="px-2.5 py-1.5 text-[11px] text-muted">+{matches.length - MAX_VISIBLE} more — refine your search</li>}
            {!matches.length && <li className="px-2.5 py-3 text-center text-xs text-muted">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
