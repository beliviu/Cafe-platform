import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider.jsx'
import { useAuth } from './auth/useAuth.js'
import { OwnerLayout } from './components/OwnerLayout.jsx'
import { LoadingScreen } from './components/LoadingScreen.jsx'
import { RouteErrorBoundary } from './components/RouteErrorBoundary.jsx'
import { ToastProvider } from './components/ui/index.js'

const DesignSystemPage = import.meta.env.DEV
  ? lazy(() => import('./pages/DesignSystemPage.jsx').then((module) => ({ default: module.DesignSystemPage })))
  : null

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.jsx').then((module) => ({ default: module.DashboardPage })),
)
const LoginPage = lazy(() =>
  import('./pages/LoginPage.jsx').then((module) => ({ default: module.LoginPage })),
)
const ProductsPage = lazy(() =>
  import('./pages/ProductsPage.jsx').then((module) => ({ default: module.ProductsPage })),
)
const CategoriesPage = lazy(() =>
  import('./pages/CategoriesPage.jsx').then((module) => ({ default: module.CategoriesPage })),
)
const OrdersPage = lazy(() =>
  import('./pages/OrdersPage.jsx').then((module) => ({ default: module.OrdersPage })),
)
const StaffLayout = lazy(() =>
  import('./components/StaffLayout.jsx').then((module) => ({ default: module.StaffLayout })),
)
const StaffOrdersPage = lazy(() =>
  import('./pages/StaffOrdersPage.jsx').then((module) => ({ default: module.StaffOrdersPage })),
)

function RequireAuth() {
  const { loading, session } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingScreen label="Memeriksa sesi..." />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return <Outlet />
}

function AppRoutes() {
  return (
    <Suspense fallback={<LoadingScreen label="Membuka halaman..." />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {DesignSystemPage && <Route path="/design" element={<DesignSystemPage />} />}
        <Route element={<RequireAuth />}>
          <Route path="staff" element={<StaffLayout />}>
            <Route index element={<StaffOrdersPage />} />
            <Route path="history" element={<StaffOrdersPage historyOnly />} />
          </Route>
          <Route element={<OwnerLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="orders" element={<OrdersPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <RouteErrorBoundary>
            <AppRoutes />
          </RouteErrorBoundary>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
