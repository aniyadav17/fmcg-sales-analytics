import { useTheme } from '../state/ThemeContext'

/** Validated categorical palette (fixed order - colour follows the entity, never its rank). */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']

/** Status colours are reserved for state and always paired with an icon + label. */
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' }

export interface ChartTheme {
  series: string[]
  /** named business series (fixed entity colours used across every page) */
  secondary: string; primary: string; target: string; prior: string; stock: string; collected: string
  grid: string; axis: string; muted: string; ink: string; ink2: string; surface: string; cursor: string
  seq: string[] // single-hue sequential ramp (blue), light -> dark
}

export function chartTheme(dark: boolean): ChartTheme {
  const s = dark ? SERIES_DARK : SERIES_LIGHT
  return {
    series: s,
    secondary: s[0], target: s[1], primary: s[2], stock: s[6], collected: s[2],
    prior: dark ? '#5d5c57' : '#c3c2b7',
    grid: dark ? '#2c2c2a' : '#e8e7e1',
    axis: dark ? '#383835' : '#c3c2b7',
    muted: '#898781',
    ink: dark ? '#ffffff' : '#0b0b0b',
    ink2: dark ? '#c3c2b7' : '#52514e',
    surface: dark ? '#1a1a19' : '#ffffff',
    cursor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(11,11,11,0.04)',
    seq: dark ? ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#86b6ef'] : ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#256abf', '#1c5cab', '#104281'],
  }
}

export function useChartTheme(): ChartTheme {
  const { dark } = useTheme()
  return chartTheme(dark)
}
