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
const AnnouncementsPage = page(() => import('./pages/AnnouncementsPage.jsx'), 'AnnouncementsPage')
const SettingsPage = page(() => import('./pages/SettingsPage.jsx'), 'SettingsPage')
const AnalyticsPage = page(() => import('./pages/AnalyticsPage.jsx'), 'AnalyticsPage')
const FinancePage = page(() => import('./pages/FinancePage.jsx'), 'FinancePage')
// File SQL 18
const TeamPage = page(() => import('./pages/TeamPage.jsx'), 'TeamPage')
const SignupsPage = page(() => import('./pages/SignupsPage.jsx'), 'SignupsPage')
const FlagsPage = page(() => import('./pages/FlagsPage.jsx'), 'FlagsPage')
const StatusAdminPage = page(() => import('./pages/StatusAdminPage.jsx'), 'StatusAdminPage')
const AiPage = page(() => import('./pages/AiPage.jsx'), 'AiPage')
const TicketsPage = page(() => import('./pages/TicketsPage.jsx'), 'TicketsPage')
const TicketDetailPage = page(() => import('./pages/TicketDetailPage.jsx'), 'TicketDetailPage')

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
                <Route path="pengumuman" element={<AnnouncementsPage />} />
                <Route path="pengaturan" element={<SettingsPage />} />
                <Route path="analitik" element={<AnalyticsPage />} />
                <Route path="keuangan" element={<FinancePage />} />
                <Route path="tim" element={<TeamPage />} />
                <Route path="pendaftaran" element={<SignupsPage />} />
                <Route path="fitur" element={<FlagsPage />} />
                <Route path="status-sistem" element={<StatusAdminPage />} />
                <Route path="tanya-ai" element={<AiPage />} />
                <Route path="tiket" element={<TicketsPage />} />
                <Route path="tiket/:ticketId" element={<TicketDetailPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
