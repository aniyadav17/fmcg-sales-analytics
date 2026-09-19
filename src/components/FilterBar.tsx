import { useMemo, useState } from 'react'
import { CalendarRange, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useData } from '../state/DataContext'
import { useFilters } from '../state/FilterContext'
import { activeFilterCount, BASIS_LABEL, DIM_FILTER_KEYS, MONTH_NAMES, monthLong, periodPresets, type Basis, type DimFilterKey } from '../state/filters'
import { MultiSelect, type Option } from './MultiSelect'
import { cx } from './ui'

const DIM_LABEL: Record<DimFilterKey, string> = {
  region: 'Region', state: 'State', territory: 'Territory', distributor: 'Distributor', salesperson: 'Salesperson',
  beat: 'Beat', outletType: 'Outlet type', category: 'Category', brand: 'Brand', sku: 'SKU',
}

export function FilterBar() {
  const ds = useData()
  const { uiFilters: f, setDim, setPeriod, setFilters, reset, scope, pending } = useFilters()
  const [open, setOpen] = useState(false)
  const m = ds.m
  const presets = periodPresets()
  const preset = presets.find(p => p.from === f.from && p.to === f.to)?.id ?? 'custom'
  const nMonths = ds.months.length
  const monthOptions = Array.from({ length: nMonths }, (_, i) => ({ value: i, label: monthLong(i) }))
  const fullYear = f.from % 12 === 0 && f.to === f.from + 11
  const year = fullYear || f.from === f.to ? 2021 + Math.floor(f.from / 12) : 0
  const month = f.from === f.to ? f.from % 12 : -1

  const opts = useMemo(() => {
    const sel = (a: number[]) => (a.length ? new Set(a) : null)
    const rS = sel(f.region), sS = sel(f.state), tS = sel(f.territory), dS = sel(f.distributor), spS = sel(f.salesperson), cS = sel(f.category), bS = sel(f.brand)
    const o: Record<DimFilterKey, Option[]> = {
      region: m.regions.map((label, value) => ({ value, label })),
      state: m.states.name.map((label, value) => ({ value, label, hint: m.regions[m.states.region[value]] }))
        .filter(o => !rS || rS.has(m.states.region[o.value])),
      territory: m.territories.name.map((label, value) => ({ value, label, hint: m.states.name[m.territories.state[value]] }))
        .filter(o => (!sS || sS.has(m.territories.state[o.value])) && (!rS || rS.has(ds.stateRegion[m.territories.state[o.value]]))),
      distributor: m.distributors.name.map((label, value) => ({ value, label, hint: `${m.distributors.id[value]} · ${m.distributors.city[value]}` }))
        .filter(o => (!tS || tS.has(ds.distTerr[o.value])) && (!sS || sS.has(ds.distState[o.value])) && (!rS || rS.has(ds.distRegion[o.value]))),
      salesperson: m.salespersons.name.map((label, value) => ({ value, label, hint: `${m.salespersons.id[value]} · ${m.distributors.name[ds.spDist[value]]}` }))
        .filter(o => scope.distOK[ds.spDist[o.value]] && (!dS || dS.has(ds.spDist[o.value]))),
      beat: m.beats.name.map((label, value) => ({ value, label, hint: `${m.beats.id[value]} · ${m.salespersons.name[ds.beatSp[value]]}` }))
        .filter(o => scope.spOK[ds.beatSp[o.value]] && (!spS || spS.has(ds.beatSp[o.value]))),
      outletType: m.outletTypes.map((label, value) => ({ value, label })),
      category: m.categories.map((label, value) => ({ value, label })),
      brand: m.brands.name.map((label, value) => ({ value, label, hint: m.categories[m.brands.cat[value]] }))
        .filter(o => !cS || cS.has(m.brands.cat[o.value])),
      sku: m.skus.name.map((label, value) => ({ value, label, hint: `${m.skus.code[value]} · ${m.skus.status[value]}` }))
        .filter(o => (!cS || cS.has(ds.skuCat[o.value])) && (!bS || bS.has(ds.skuBrand[o.value]))),
    }
    return o
  }, [ds, m, f, scope])

  const chips = DIM_FILTER_KEYS.flatMap(k => f[k].map(v => ({ k, v, label: opts[k].find(o => o.value === v)?.label ?? String(v) })))
  const count = activeFilterCount(f)

  return (
    <div className="relative border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:px-6">
      {pending && <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"><div className="skeleton h-full w-full !bg-[linear-gradient(90deg,transparent,var(--accent),transparent)]" /></div>}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarRange size={15} className="text-muted" />
        <select aria-label="Period" value={preset} onChange={e => { const p = presets.find(x => x.id === e.target.value); if (p) setPeriod(p.from, p.to) }}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink focus:border-accent focus:outline-none">
          {presets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          {preset === 'custom' && <option value="custom">Custom range</option>}
        </select>
        <div className="hidden items-center gap-1 text-xs text-muted sm:flex">
          <select aria-label="From month" value={f.from} onChange={e => setPeriod(Number(e.target.value), Math.max(Number(e.target.value), f.to))}
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink focus:outline-none">
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span>to</span>
          <select aria-label="To month" value={f.to} onChange={e => setPeriod(Math.min(f.from, Number(e.target.value)), Number(e.target.value))}
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink focus:outline-none">
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <select aria-label="Year" value={year} onChange={e => {
          const y = Number(e.target.value)
          if (!y) return setPeriod(0, nMonths - 1)
          const base = (y - 2021) * 12
          if (month >= 0) setPeriod(base + month, base + month); else setPeriod(base, base + 11)
        }} className="hidden rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink focus:outline-none sm:block">
          <option value={0}>Year: all / custom</option>
          {[2021, 2022, 2023, 2024, 2025].map(y => <option key={y} value={y}>Year {y}</option>)}
        </select>
        <select aria-label="Month" value={month} onChange={e => {
          const mo = Number(e.target.value)
          const y = year || 2021 + Math.floor(f.to / 12)
          const base = (y - 2021) * 12
          if (mo < 0) setPeriod(base, base + 11); else setPeriod(base + mo, base + mo)
        }} className="hidden rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink focus:outline-none sm:block">
          <option value={-1}>Month: all</option>
          {MONTH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <select aria-label="Sales type" value={f.basis} onChange={e => setFilters(x => ({ ...x, basis: e.target.value as Basis }))}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none" title="Sales type used for 'Sales' measures">
          {(Object.keys(BASIS_LABEL) as Basis[]).map(b => <option key={b} value={b}>Sales type: {BASIS_LABEL[b]}</option>)}
        </select>
        <button onClick={() => setOpen(o => !o)} className={cx('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
          open || count ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2')}>
          <SlidersHorizontal size={13} /> Filters{count ? ` (${count})` : ''}
        </button>
        {(count > 0 || preset !== 'cy2025' || f.basis !== 'net_secondary') && (
          <button onClick={reset} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:text-ink">
            <RotateCcw size={12} /> Reset
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {DIM_FILTER_KEYS.map(k => (
            <MultiSelect key={k} label={DIM_LABEL[k]} options={opts[k]} value={f[k]} onChange={v => setDim(k, v)} />
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.slice(0, 14).map(c => (
            <span key={`${c.k}-${c.v}`} className="inline-flex max-w-[260px] items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2 pr-1 text-[11px] text-accent">
              <span className="truncate"><b className="font-semibold">{DIM_LABEL[c.k]}:</b> {c.label}</span>
              <button aria-label="Remove filter" onClick={() => setDim(c.k, f[c.k].filter(x => x !== c.v))} className="rounded-full p-0.5 hover:bg-accent/15"><X size={11} /></button>
            </span>
          ))}
          {chips.length > 14 && <span className="text-[11px] text-muted">+{chips.length - 14} more</span>}
        </div>
      )}
    </div>
  )
}
