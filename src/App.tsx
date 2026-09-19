import { lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LoadingScreen } from './components/LoadingScreen'
import { DataProvider, useDataState } from './state/DataContext'
import { FilterProvider } from './state/FilterContext'
import { ThemeProvider } from './state/ThemeContext'

// Pages are code-split: each route's JS loads on first visit.
const Executive = lazy(() => import('./pages/Executive'))
const SalesPerformance = lazy(() => import('./pages/SalesPerformance'))
const Distributors = lazy(() => import('./pages/Distributors'))
const SalesForce = lazy(() => import('./pages/SalesForce'))
const Products = lazy(() => import('./pages/Products'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Collections = lazy(() => import('./pages/Collections'))
const Exceptions = lazy(() => import('./pages/Exceptions'))
const DataQuality = lazy(() => import('./pages/DataQuality'))
const DataModel = lazy(() => import('./pages/DataModel'))
const KpiDefinitions = lazy(() => import('./pages/KpiDefinitions'))

function Shell() {
  const { ds, error, progress } = useDataState()
  if (!ds) return <LoadingScreen {...progress} error={error} />
  return (
    <FilterProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Executive />} />
            <Route path="sales" element={<SalesPerformance />} />
            <Route path="distributors" element={<Distributors />} />
            <Route path="salesforce" element={<SalesForce />} />
            <Route path="products" element={<Products />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="collections" element={<Collections />} />
            <Route path="exceptions" element={<Exceptions />} />
            <Route path="data-quality" element={<DataQuality />} />
            <Route path="data-model" element={<DataModel />} />
            <Route path="kpis" element={<KpiDefinitions />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </FilterProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <DataProvider>
        <Shell />
      </DataProvider>
    </ThemeProvider>
  )
}
