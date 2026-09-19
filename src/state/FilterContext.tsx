import { createContext, useCallback, useContext, useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { buildScope, type Scope } from '../analytics/engine'
import { useData } from './DataContext'
import { defaultFilters, type DimFilterKey, type Filters } from './filters'

interface FilterCtx {
  /** filters the pages compute with (deferred so the controls never block) */
  filters: Filters
  /** filters as currently set in the controls */
  uiFilters: Filters
  /** true while pages are still recomputing for the latest filter change */
  pending: boolean
  scope: Scope
  setFilters: (f: Filters | ((f: Filters) => Filters)) => void
  setDim: (k: DimFilterKey, v: number[]) => void
  setPeriod: (from: number, to: number) => void
  reset: () => void
}
const Ctx = createContext<FilterCtx | null>(null)

const KEY = 'fmcg-filters-v1'
function load(): Filters {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return { ...defaultFilters(), ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return defaultFilters()
}

/** Children of a hierarchy level are cleared when the parent selection changes. */
const CHILDREN: Partial<Record<DimFilterKey, DimFilterKey[]>> = {
  region: ['state', 'territory', 'distributor', 'salesperson', 'beat'],
  state: ['territory', 'distributor', 'salesperson', 'beat'],
  territory: ['distributor', 'salesperson', 'beat'],
  distributor: ['salesperson', 'beat'],
  salesperson: ['beat'],
  category: ['brand', 'sku'],
  brand: ['sku'],
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const ds = useData()
  const [filters, setRaw] = useState<Filters>(load)
  const setFilters = useCallback((f: Filters | ((f: Filters) => Filters)) => {
    setRaw(prev => {
      const next = typeof f === 'function' ? f(prev) : f
      try { sessionStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])
  const setDim = useCallback((k: DimFilterKey, v: number[]) => setFilters(f => {
    const next = { ...f, [k]: v }
    for (const c of CHILDREN[k] ?? []) next[c] = []
    return next
  }), [setFilters])
  const setPeriod = useCallback((from: number, to: number) => setFilters(f => ({ ...f, from: Math.min(from, to), to: Math.max(from, to) })), [setFilters])
  const reset = useCallback(() => setFilters(defaultFilters()), [setFilters])
  const deferred = useDeferredValue(filters)
  const scope = useMemo(() => buildScope(ds, deferred), [ds, deferred])
  const value = useMemo(() => ({ filters: deferred, uiFilters: filters, pending: deferred !== filters, scope, setFilters, setDim, setPeriod, reset }),
    [deferred, filters, scope, setFilters, setDim, setPeriod, reset])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFilters(): FilterCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useFilters outside FilterProvider')
  return c
}
