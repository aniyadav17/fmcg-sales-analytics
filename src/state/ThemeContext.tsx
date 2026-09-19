import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface ThemeCtx { dark: boolean; toggle: () => void }
const Ctx = createContext<ThemeCtx>({ dark: false, toggle: () => {} })

function initial(): boolean {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('theme') : null
  if (q === 'dark' || q === 'light') return q === 'dark' // e.g. ?theme=dark for sharing / screenshots
  try {
    const saved = localStorage.getItem('fmcg-theme')
    if (saved) return saved === 'dark'
  } catch { /* storage unavailable */ }
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(initial)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { localStorage.setItem('fmcg-theme', dark ? 'dark' : 'light') } catch { /* ignore */ }
  }, [dark])
  return <Ctx.Provider value={{ dark, toggle: () => setDark(d => !d) }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
