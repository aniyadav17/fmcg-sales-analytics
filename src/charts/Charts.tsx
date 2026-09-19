import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import type { ReactNode } from 'react'
import { inrAxis, inr } from '../utils/format'
import { useChartTheme } from './theme'
import { EmptyState } from '../components/ui'

type Fmt = (v: number) => string

/* -------------------------------------------------------------------------- tooltip & legend */
interface TipItem { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }
export function ChartTooltip({ active, payload, label, fmt = inr, extra }: {
  active?: boolean; payload?: TipItem[]; label?: ReactNode; fmt?: Fmt; extra?: (row: Record<string, unknown>) => ReactNode
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload ?? {}
  return (
    <div className="min-w-[170px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined && label !== '' && <p className="mb-1 font-semibold text-ink">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.name}</span>
          <span className="font-medium text-ink tabular">{typeof p.value === 'number' ? fmt(p.value) : p.value}</span>
        </div>
      ))}
      {extra?.(row)}
    </div>
  )
}

export interface SeriesSpec { key: string; name: string; color: string; type?: 'bar' | 'line' | 'area'; stack?: string; dashed?: boolean }

export function SeriesLegend({ items }: { items: { name: string; color: string; type?: 'bar' | 'line' | 'area' }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
      {items.map(i => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          {i.type === 'line' ? <span className="h-[2px] w-3.5 rounded" style={{ background: i.color }} /> : <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />}
          {i.name}
        </span>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- time series combo */
export function ComboChart({ data, series, height = 260, yFmt = inrAxis, tipFmt = inr, xKey = 'label', legend = true, onClick, yDomain }: {
  data: Record<string, unknown>[]; series: SeriesSpec[]; height?: number; yFmt?: Fmt; tipFmt?: Fmt; xKey?: string; legend?: boolean
  onClick?: (row: Record<string, unknown>) => void; yDomain?: [number | string, number | string]
}) {
  const t = useChartTheme()
  if (!data.length) return <EmptyState />
  return (
    <div>
      {legend && series.length > 1 && <SeriesLegend items={series.map(s => ({ name: s.name, color: s.color, type: s.type === 'line' ? 'line' : 'bar' }))} />}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barGap={2}
          onClick={onClick ? (e: unknown) => { const p = (e as { activePayload?: { payload: Record<string, unknown> }[] })?.activePayload?.[0]?.payload; if (p) onClick(p) } : undefined}>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: t.axis }} tick={{ fontSize: 11 }} minTickGap={12} />
          <YAxis tickFormatter={yFmt} tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11 }} domain={yDomain} />
          <Tooltip cursor={{ fill: t.cursor, stroke: t.axis }} content={<ChartTooltip fmt={tipFmt} />} />
          {series.map(s => s.type === 'line'
            ? <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }} strokeDasharray={s.dashed ? '5 4' : undefined} isAnimationActive={false} connectNulls />
            : <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={s.stack} maxBarSize={24} radius={s.stack ? 0 : [4, 4, 0, 0]} isAnimationActive={false} stroke={s.stack ? t.surface : undefined} strokeWidth={s.stack ? 1 : 0} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/* -------------------------------------------------------------------------- ranked horizontal bars */
export interface RankRow { name: string; value: number; sub?: string; color?: string; id?: number }
export function RankBars({ data, fmt = inr, color, height, onClick, labelWidth = 150 }: {
  data: RankRow[]; fmt?: Fmt; color?: string; height?: number; onClick?: (r: RankRow) => void; labelWidth?: number
}) {
  const t = useChartTheme()
  if (!data.length) return <EmptyState />
  const h = height ?? Math.max(120, data.length * 28 + 20)
  const hasNeg = data.some(d => d.value < 0)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
        <XAxis type="number" hide domain={hasNeg ? [(lo: number) => Math.min(0, lo), (hi: number) => Math.max(0, hi)] : [0, 'dataMax']} />
        <YAxis type="category" dataKey="name" width={labelWidth} tickLine={false} axisLine={false}
          tick={(p: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => {
            const v = String(p.payload?.value ?? '')
            const max = Math.floor(labelWidth / 6.6)
            return <text x={Number(p.x) - 6} y={Number(p.y)} dy={4} textAnchor="end" fontSize={11} fill={t.ink2}>{v.length > max ? v.slice(0, max - 1) + '…' : v}</text>
          }} />
        <Tooltip cursor={{ fill: t.cursor }} content={<ChartTooltip fmt={fmt} extra={r => r.sub ? <p className="mt-1 text-[11px] text-muted">{String(r.sub)}</p> : null} />} />
        {hasNeg && <ReferenceLine x={0} stroke={t.axis} />}
        <Bar dataKey="value" name="Value" maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}
          onClick={onClick ? (d: unknown) => onClick((d as { payload: RankRow }).payload) : undefined} cursor={onClick ? 'pointer' : undefined}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? color ?? t.secondary} />)}
          <LabelList dataKey="value" content={(p: unknown) => {
            // negative bars: label sits just right of the zero line so it never collides with the category axis
            const { x = 0, y = 0, width = 0, height = 0, value } = p as { x?: number; y?: number; width?: number; height?: number; value?: unknown }
            const v = Number(value)
            const zero = width >= 0 ? (v < 0 ? Number(x) + Number(width) : Number(x)) : Number(x)
            const end = v < 0 ? zero : Number(x) + Number(width)
            return <text x={end + 4} y={Number(y) + Number(height) / 2} dy={4} fontSize={11} fill={t.ink2}>{fmt(v)}</text>
          }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/* -------------------------------------------------------------------------- donut */
export function Donut({ data, fmt = inr, height = 220, center, vertical = false }: {
  data: { name: string; value: number; color: string }[]; fmt?: Fmt; height?: number; center?: ReactNode; vertical?: boolean
}) {
  const t = useChartTheme()
  const total = data.reduce((a, b) => a + Math.max(0, b.value), 0)
  if (!total) return <EmptyState />
  return (
    <div className={vertical ? 'flex flex-col items-center gap-3' : 'flex flex-col items-center gap-3 sm:flex-row'}>
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.filter(d => d.value > 0)} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="98%" paddingAngle={1} stroke={t.surface} strokeWidth={2} isAnimationActive={false}>
              {data.filter(d => d.value > 0).map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip fmt={v => `${fmt(v)} · ${((v / total) * 100).toFixed(1)}%`} />} />
          </PieChart>
        </ResponsiveContainer>
        {center && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
      </div>
      <ul className="w-full min-w-0 space-y-1 text-xs">
        {data.map(d => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-ink-2"><span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: d.color }} /><span className="truncate">{d.name}</span></span>
            <span className="shrink-0 text-ink tabular">{fmt(d.value)} <span className="text-muted">({((d.value / total) * 100).toFixed(1)}%)</span></span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------- quadrant scatter */
export interface ScatterPt { x: number; y: number; z?: number; name: string; id: number; color?: string; sub?: string }
export function QuadrantScatter({ data, xLabel, yLabel, xFmt = inrAxis, yFmt = inrAxis, tipX = inr, tipY = inr, onClick, height = 340, quadrants, xRef, yRef, log = false }: {
  data: ScatterPt[]; xLabel: string; yLabel: string; xFmt?: Fmt; yFmt?: Fmt; tipX?: Fmt; tipY?: Fmt; onClick?: (p: ScatterPt) => void
  height?: number; quadrants?: [string, string, string, string]; xRef: number; yRef: number; log?: boolean
}) {
  const t = useChartTheme()
  // log scales spread skewed business data (a few very large distributors) across the plot
  const pts = log ? data.filter(d => d.x > 0 && d.y > 0) : data
  if (!pts.length) return <EmptyState />
  const maxX = Math.max(...pts.map(d => d.x)) * (log ? 1.4 : 1.05), maxY = Math.max(...pts.map(d => d.y)) * (log ? 1.4 : 1.05)
  const minX = log ? Math.min(...pts.map(d => d.x)) / 1.4 : 0, minY = log ? Math.min(...pts.map(d => d.y)) / 1.4 : 0
  const logTicks = (lo: number, hi: number) => { const out: number[] = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo && v <= hi) out.push(v) } return out }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 10, right: 16, left: 4, bottom: 18 }}>
        <CartesianGrid stroke={t.grid} />
        {quadrants && <>
          <ReferenceArea x1={xRef} x2={maxX} y1={yRef} y2={maxY} fill={t.series[1]} fillOpacity={0.04} label={{ value: quadrants[0], position: 'insideTopRight', fontSize: 11, fill: t.ink2 }} />
          <ReferenceArea x1={minX} x2={xRef} y1={yRef} y2={maxY} fill={t.series[7]} fillOpacity={0.05} label={{ value: quadrants[1], position: 'insideTopLeft', fontSize: 11, fill: t.ink2 }} />
          <ReferenceArea x1={xRef} x2={maxX} y1={minY} y2={yRef} fill={t.series[0]} fillOpacity={0.04} label={{ value: quadrants[2], position: 'insideBottomRight', fontSize: 11, fill: t.ink2 }} />
          <ReferenceArea x1={minX} x2={xRef} y1={minY} y2={yRef} fill={t.muted} fillOpacity={0.04} label={{ value: quadrants[3], position: 'insideBottomLeft', fontSize: 11, fill: t.ink2 }} />
        </>}
        <XAxis type="number" dataKey="x" name={xLabel} tickFormatter={xFmt} domain={[minX, maxX]} scale={log ? 'log' : 'auto'} ticks={log ? logTicks(minX, maxX) : undefined} allowDataOverflow tickLine={false} axisLine={{ stroke: t.axis }}
          label={{ value: xLabel, position: 'insideBottom', offset: -10, fontSize: 11, fill: t.muted }} />
        <YAxis type="number" dataKey="y" name={yLabel} tickFormatter={yFmt} domain={[minY, maxY]} scale={log ? 'log' : 'auto'} ticks={log ? logTicks(minY, maxY) : undefined} allowDataOverflow tickLine={false} axisLine={false} width={56}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: t.muted, dy: 40 }} />
        <ZAxis type="number" dataKey="z" range={[40, 260]} />
        <ReferenceLine x={xRef} stroke={t.axis} />
        <ReferenceLine y={yRef} stroke={t.axis} />
        <Tooltip cursor={{ stroke: t.axis }} content={(props: unknown) => {
          const { active, payload } = props as { active?: boolean; payload?: readonly { payload: ScatterPt }[] }
          if (!active || !payload?.length) return null
          const p = payload[0].payload
          return (
            <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
              <p className="font-semibold text-ink">{p.name}</p>
              {p.sub && <p className="text-[11px] text-muted">{p.sub}</p>}
              <p className="mt-1 text-ink-2">{xLabel}: <b className="text-ink">{tipX(p.x)}</b></p>
              <p className="text-ink-2">{yLabel}: <b className="text-ink">{tipY(p.y)}</b></p>
            </div>
          )
        }} />
        <Scatter data={pts} isAnimationActive={false} onClick={onClick ? (d: unknown) => onClick((d as { payload: ScatterPt }).payload ?? (d as ScatterPt)) : undefined} cursor={onClick ? 'pointer' : undefined}>
          {pts.map((d, i) => <Cell key={i} fill={d.color ?? t.secondary} fillOpacity={0.8} stroke={t.surface} strokeWidth={1.5} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  )
}

/* -------------------------------------------------------------------------- simple vertical bars (categorical x) */
export function ColumnChart({ data, series, height = 240, yFmt = inrAxis, tipFmt = inr, xKey = 'label', stacked = false, legend = true }: {
  data: Record<string, unknown>[]; series: SeriesSpec[]; height?: number; yFmt?: Fmt; tipFmt?: Fmt; xKey?: string; stacked?: boolean; legend?: boolean
}) {
  const t = useChartTheme()
  if (!data.length) return <EmptyState />
  return (
    <div>
      {legend && series.length > 1 && <SeriesLegend items={series.map(s => ({ name: s.name, color: s.color }))} />}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: t.axis }} tick={{ fontSize: 11 }} interval={0} />
          <YAxis tickFormatter={yFmt} tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11 }} />
          <Tooltip cursor={{ fill: t.cursor }} content={<ChartTooltip fmt={tipFmt} />} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? 'a' : undefined} maxBarSize={28}
              radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]} stroke={stacked ? t.surface : undefined} strokeWidth={stacked ? 1 : 0} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
