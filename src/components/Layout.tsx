import { Suspense, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3, BookOpen, Boxes, ClipboardCheck, Gauge, IndianRupee, Menu, Moon, Package, Siren, Sun, Truck, Users, X, Database,
} from 'lucide-react'
import { useData } from '../state/DataContext'
import { useTheme } from '../state/ThemeContext'
import { FilterBar } from './FilterBar'
import { ErrorBoundary } from './ErrorBoundary'
import { cx, Skeleton } from './ui'

export const NAV: { to: string; label: string; icon: ReactNode; group: string; filters?: boolean }[] = [
  { to: '/', label: 'Executive Overview', icon: <Gauge size={16} />, group: 'Performance', filters: true },
  { to: '/sales', label: 'Sales Performance', icon: <BarChart3 size={16} />, group: 'Performance', filters: true },
  { to: '/distributors', label: 'Distributor Analytics', icon: <Truck size={16} />, group: 'Performance', filters: true },
  { to: '/salesforce', label: 'Salesperson & Beat', icon: <Users size={16} />, group: 'Performance', filters: true },
  { to: '/products', label: 'Product & SKU', icon: <Package size={16} />, group: 'Performance', filters: true },
  { to: '/inventory', label: 'Inventory & Stock', icon: <Boxes size={16} />, group: 'Supply & Cash', filters: true },
  { to: '/collections', label: 'Collections', icon: <IndianRupee size={16} />, group: 'Supply & Cash', filters: true },
  { to: '/exceptions', label: 'Exceptions & Opportunities', icon: <Siren size={16} />, group: 'Action', filters: true },
  { to: '/data-quality', label: 'Data Quality', icon: <ClipboardCheck size={16} />, group: 'Governance' },
  { to: '/data-model', label: 'Data Model', icon: <Database size={16} />, group: 'Governance' },
  { to: '/kpis', label: 'KPI Definitions', icon: <BookOpen size={16} />, group: 'Governance' },
]

export function Layout() {
  const ds = useData()
  const { dark, toggle } = useTheme()
  const [menu, setMenu] = useState(false)
  const loc = useLocation()
  const current = NAV.find(n => n.to === loc.pathname) ?? NAV[0]
  const groups = [...new Set(NAV.map(n => n.group))]

  const nav = (
    <nav className="flex flex-col gap-4 px-3 py-4">
      {groups.map(g => (
        <div key={g}>
          <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{g}</p>
          {NAV.filter(n => n.group === g).map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setMenu(false)}
              className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]',
                isActive ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
              {n.icon}{n.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex h-full">
      <aside className="scroll-thin hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-surface lg:block">
        <Brand />
        {nav}
        <DatasetFootnote rows={ds.sales.n} />
      </aside>
      {menu && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenu(false)} />
          <aside className="scroll-thin absolute inset-y-0 left-0 w-64 overflow-y-auto bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-3"><Brand /><button aria-label="Close menu" onClick={() => setMenu(false)}><X size={18} /></button></div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 lg:px-6">
          <button aria-label="Open menu" className="lg:hidden" onClick={() => setMenu(true)}><Menu size={18} /></button>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{ds.manifest.company} · Sales MIS</p>
            <p className="truncate text-sm font-semibold text-ink">{current.label}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[11px] text-muted md:inline">Data as of <b className="font-semibold text-ink-2">31 Dec 2025</b></span>
            <button onClick={toggle} aria-label="Toggle dark mode" className="rounded-md border border-line p-1.5 text-ink-2 hover:bg-surface-2">
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>
        {current.filters && <FilterBar />}
        <main className="scroll-thin flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <ErrorBoundary key={loc.pathname}>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 pt-4 pb-1">
      <img src="./favicon.svg" alt="" className="h-7 w-7" />
      <div>
        <p className="text-sm font-bold leading-tight text-ink">FMCG Sales</p>
        <p className="text-[11px] leading-tight text-muted">Analytics & Distribution</p>
      </div>
    </div>
  )
}

function DatasetFootnote({ rows }: { rows: number }) {
  return (
    <div className="mx-3 mb-4 rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
      <b className="text-ink-2">{(rows / 1e6).toFixed(2)}M</b> transaction lines · Jan 2021 – Dec 2025 · synthetic data, analysed in-browser.
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-64" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
    </div>
  )
}
