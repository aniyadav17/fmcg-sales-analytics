import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadDataset, StaticFileSource, type DataSource } from '../data/loader'
import type { Dataset } from '../data/types'

interface DataState { ds: Dataset | null; error: string | null; progress: { done: number; total: number; label: string } }
const Ctx = createContext<DataState>({ ds: null, error: null, progress: { done: 0, total: 1, label: '' } })

export function DataProvider({ children, source }: { children: ReactNode; source?: DataSource }) {
  const [state, setState] = useState<DataState>({ ds: null, error: null, progress: { done: 0, total: 6, label: 'manifest' } })
  useEffect(() => {
    let cancelled = false
    const src = source ?? new StaticFileSource(import.meta.env.BASE_URL + 'data/')
    const t0 = performance.now()
    loadDataset(src, (done, total, label) => { if (!cancelled) setState(s => ({ ...s, progress: { done, total, label } })) })
      .then(ds => {
        if (cancelled) return
        console.info(`[data] ${ds.sales.n.toLocaleString()} sales rows, ${ds.stock.n.toLocaleString()} stock rows loaded in ${Math.round(performance.now() - t0)} ms`)
        if (import.meta.env.DEV) (window as unknown as { __fmcg: unknown }).__fmcg = ds // debugging / benchmarking hook (dev only)
        setState(s => ({ ...s, ds }))
      })
      .catch(e => { if (!cancelled) setState(s => ({ ...s, error: String(e?.message ?? e) })) })
    return () => { cancelled = true }
  }, [source])
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export const useDataState = () => useContext(Ctx)
/** Only call inside the loaded app shell. */
export function useData(): Dataset {
  const { ds } = useContext(Ctx)
  if (!ds) throw new Error('Dataset not loaded')
  return ds
}
