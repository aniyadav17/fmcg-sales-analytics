import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, OctagonAlert, Inbox, CircleAlert } from 'lucide-react'
import { kpi } from '../content/kpis'

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' ') }

export function Card({ title, subtitle, actions, children, className, bodyClass, info }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; info?: string
}) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03)] min-w-0', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5 pb-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">{title}{info && <InfoTip id={info} />}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('px-4 pb-4', !title && !actions && 'pt-4', bodyClass)}>{children}</div>
    </section>
  )
}

/** KPI tooltip sourced from the KPI dictionary. */
export function InfoTip({ id, text }: { id?: string; text?: string }) {
  const [open, setOpen] = useState(false)
  const d = id ? kpi(id) : undefined
  if (!d && !text) return null
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={`About ${d?.name ?? 'this metric'}`} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="text-muted hover:text-ink-2 focus:outline-none">
        <Info size={13} />
      </button>
      {open && (
        <span role="tooltip" className="absolute left-1/2 top-5 z-50 w-72 -translate-x-1/2 rounded-lg border border-line bg-surface p-3 text-left text-xs font-normal text-ink-2 shadow-lg">
          {d ? (<>
            <span className="block font-semibold text-ink">{d.name}</span>
            <span className="mt-1 block">{d.definition}</span>
            <span className="mt-1.5 block rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink">{d.formula}</span>
            <span className="mt-1.5 block italic">{d.interpretation}</span>
          </>) : text}
        </span>
      )}
    </span>
  )
}

export type Tone = 'good' | 'warn' | 'serious' | 'critical' | 'neutral' | 'accent'
const toneCls: Record<Tone, string> = {
  good: 'bg-good-bg text-good', warn: 'bg-warn-bg text-warn', serious: 'bg-serious-bg text-serious',
  critical: 'bg-critical-bg text-critical', neutral: 'bg-surface-3 text-ink-2', accent: 'bg-accent-soft text-accent',
}
const toneIcon: Record<Tone, ReactNode> = {
  good: <CheckCircle2 size={12} />, warn: <AlertTriangle size={12} />, serious: <CircleAlert size={12} />,
  critical: <OctagonAlert size={12} />, neutral: null, accent: null,
}
export function Badge({ tone = 'neutral', children, icon = true }: { tone?: Tone; children: ReactNode; icon?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', toneCls[tone])}>
      {icon && toneIcon[tone]}{children}
    </span>
  )
}

export const achTone = (a: number): Tone => (Number.isNaN(a) ? 'neutral' : a >= 100 ? 'good' : a >= 90 ? 'warn' : a >= 80 ? 'serious' : 'critical')
export const growthTone = (g: number): Tone => (Number.isNaN(g) ? 'neutral' : g >= 10 ? 'good' : g >= 0 ? 'warn' : g >= -10 ? 'serious' : 'critical')

export function Delta({ value, suffix = '%', goodUp = true, label }: { value: number; suffix?: string; goodUp?: boolean; label?: string }) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return <span className="text-xs text-muted">{label ? `${label}: ` : ''}—</span>
  const up = value >= 0
  const good = up === goodUp
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-xs font-medium tabular', good ? 'text-good' : 'text-critical')}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {up ? '+' : ''}{value.toFixed(1)}{suffix}
      {label && <span className="ml-1 font-normal text-muted">{label}</span>}
    </span>
  )
}

export function KpiCard({ label, value, sub, delta, deltaLabel = 'vs LY', goodUp = true, info, tone, onClick, footer }: {
  label: string; value: ReactNode; sub?: ReactNode; delta?: number; deltaLabel?: string; goodUp?: boolean
  info?: string; tone?: Tone; onClick?: () => void; footer?: ReactNode
}) {
  return (
    <div onClick={onClick} className={cx('relative flex min-w-0 flex-col rounded-xl border border-line bg-surface px-3.5 py-3', onClick && 'cursor-pointer hover:border-line-strong')}>
      {tone && tone !== 'neutral' && <span className={cx('absolute left-0 top-3 bottom-3 w-[3px] rounded-r', {
        good: 'bg-good', warn: 'bg-warn', serious: 'bg-serious', critical: 'bg-critical', accent: 'bg-accent', neutral: '',
      }[tone])} />}
      <div className="flex items-center gap-1 text-xs font-medium text-muted">
        <span className="truncate">{label}</span>{info && <InfoTip id={info} />}
      </div>
      <div className="mt-1 truncate text-[21px] font-semibold leading-tight text-ink">{value}</div>
      <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-x-2 gap-y-0.5">
        {delta !== undefined && <Delta value={delta} goodUp={goodUp} label={deltaLabel} />}
        {sub && <span className="truncate text-xs text-muted">{sub}</span>}
      </div>
      {footer}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'sm' }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: 'sm' | 'xs'
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cx('rounded-md font-medium transition-colors', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink-2')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ title = 'No data for the current filters', hint = 'Widen the date range or clear some filters.' }: { title?: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
      <Inbox size={26} className="text-muted" />
      <p className="text-sm font-medium text-ink-2">{title}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  )
}

export function Note({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <div className={cx('flex items-start gap-2 rounded-lg px-3 py-2 text-xs', toneCls[tone])}><Info size={14} className="mt-px shrink-0" /><div>{children}</div></div>
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) { return <div className={cx('skeleton rounded-lg', className)} /> }

export function Select<T extends string | number>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string; className?: string
}) {
  return (
    <label className={cx('inline-flex items-center gap-1.5 text-xs text-muted', className)}>
      {label && <span>{label}</span>}
      <select value={String(value)} onChange={e => {
        const raw = e.target.value
        const opt = options.find(o => String(o.value) === raw)
        if (opt) onChange(opt.value)
      }} className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none">
        {options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </label>
  )
}

/** Small inline bar used inside tables (e.g. achievement, contribution). */
export function InlineBar({ value, max = 100, tone = 'accent' }: { value: number; max?: number; tone?: Tone }) {
  const w = Number.isFinite(value) ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const bg = { good: 'bg-good', warn: 'bg-warn', serious: 'bg-serious', critical: 'bg-critical', accent: 'bg-accent', neutral: 'bg-muted' }[tone]
  return <div className="h-1.5 w-full rounded-full bg-surface-3"><div className={cx('h-1.5 rounded-full', bg)} style={{ width: `${w}%` }} /></div>
}
