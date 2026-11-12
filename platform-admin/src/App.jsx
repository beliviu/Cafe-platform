import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider.jsx'
import { AdminLayout, LoadingScreen } from './components/AdminLayout.jsx'
import { ToastProvider } from './components/ui/index.js'
import { LoginPage } from './pages/LoginPage.jsx'
import { MfaPage } from './pages/MfaPage.jsx'

const page = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })))
const OverviewPage = page(() => import('./pages/OverviewPage.jsx'), 'OverviewPage')
const CafesPage = page(() => import('./pages/CafesPage.jsx'), 'CafesPage')
const CafeDetailPage = page(() => import('./pages/CafeDetailPage.jsx'), 'CafeDetailPage')
const PlansPage = page(() => import('./pages/PlansPage.jsx'), 'PlansPage')
const InvoicesPage = page(() => import('./pages/InvoicesPage.jsx'), 'InvoicesPage')
const AuditPage = page(() => import('./pages/AuditPage.jsx'), 'AuditPage')

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/mfa" element={<MfaPage />} />
              <Route element={<AdminLayout />}>
                <Route index element={<OverviewPage />} />
                <Route path="kafe" element={<CafesPage />} />
                <Route path="kafe/:cafeId" element={<CafeDetailPage />} />
                <Route path="paket" element={<PlansPage />} />
                <Route path="tagihan" element={<InvoicesPage />} />
                <Route path="audit" element={<AuditPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
