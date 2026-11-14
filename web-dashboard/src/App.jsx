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

const OwnerPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/OwnerPreview.jsx').then((module) => ({ default: module.OwnerPreview })))
  : null

const StaffPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/StaffPreview.jsx').then((module) => ({ default: module.StaffPreview })))
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
const PromotionsPage = lazy(() =>
  import('./pages/PromotionsPage.jsx').then((module) => ({ default: module.PromotionsPage })),
)
const OrdersPage = lazy(() =>
  import('./pages/OrdersPage.jsx').then((module) => ({ default: module.OrdersPage })),
)
const SettingsLayout = lazy(() =>
  import('./pages/settings/SettingsLayout.jsx').then((module) => ({ default: module.SettingsLayout })),
)
const GeneralSettings = lazy(() => import('./pages/settings/SettingsPages.jsx').then((module) => ({ default: module.GeneralSettings })))
const OperationsSettings = lazy(() => import('./pages/settings/SettingsPages.jsx').then((module) => ({ default: module.OperationsSettings })))
const ChargesSettings = lazy(() => import('./pages/settings/SettingsPages.jsx').then((module) => ({ default: module.ChargesSettings })))
const AppearanceSettings = lazy(() => import('./pages/settings/AppearanceSettings.jsx').then((module) => ({ default: module.AppearanceSettings })))
const ReceiptSettings = lazy(() => import('./pages/settings/SettingsPages.jsx').then((module) => ({ default: module.ReceiptSettings })))
const OrderingSettings = lazy(() => import('./pages/settings/OrderingSettings.jsx').then((module) => ({ default: module.OrderingSettings })))
const LoyaltyPage = lazy(() => import('./pages/customers/LoyaltyPage.jsx').then((module) => ({ default: module.LoyaltyPage })))
const ReviewsPage = lazy(() => import('./pages/customers/ReviewsPage.jsx').then((module) => ({ default: module.ReviewsPage })))
const SupportPage = lazy(() => import('./pages/customers/SupportPage.jsx').then((module) => ({ default: module.SupportPage })))
const StaffSupportPage = lazy(() => import('./pages/customers/SupportPage.jsx').then((module) => ({ default: module.StaffSupportPage })))
const PaymentSettings = lazy(() => import('./pages/settings/PaymentSettings.jsx').then((module) => ({ default: module.PaymentSettings })))
const OnlinePaymentsPage = lazy(() => import('./pages/payments/OnlinePaymentsPage.jsx').then((module) => ({ default: module.OnlinePaymentsPage })))
const SubscriptionSettings = lazy(() => import('./pages/settings/SubscriptionSettings.jsx').then((module) => ({ default: module.SubscriptionSettings })))
const TablesSettings = lazy(() => import('./pages/settings/TablesSettings.jsx').then((module) => ({ default: module.TablesSettings })))
const TeamLayout = lazy(() => import('./pages/team/TeamPages.jsx').then((module) => ({ default: module.TeamLayout })))
const MembersPage = lazy(() => import('./pages/team/TeamPages.jsx').then((module) => ({ default: module.MembersPage })))
const ShiftsPage = lazy(() => import('./pages/team/TeamPages.jsx').then((module) => ({ default: module.ShiftsPage })))
const ActivityPage = lazy(() => import('./pages/team/TeamPages.jsx').then((module) => ({ default: module.ActivityPage })))
const InventoryLayout = lazy(() => import('./pages/inventory/InventoryLayout.jsx').then((module) => ({ default: module.InventoryLayout })))
const IngredientsPage = lazy(() => import('./pages/inventory/IngredientsPage.jsx').then((module) => ({ default: module.IngredientsPage })))
const MovementsPage = lazy(() => import('./pages/inventory/MovementsPage.jsx').then((module) => ({ default: module.MovementsPage })))
const StockCountPage = lazy(() => import('./pages/inventory/StockCountPage.jsx').then((module) => ({ default: module.StockCountPage })))
const ForecastPage = lazy(() => import('./pages/inventory/ForecastPage.jsx').then((module) => ({ default: module.ForecastPage })))
const RecipesLayout = lazy(() => import('./pages/recipes/RecipesPages.jsx').then((module) => ({ default: module.RecipesLayout })))
const ProductCostingPage = lazy(() => import('./pages/recipes/RecipesPages.jsx').then((module) => ({ default: module.ProductCostingPage })))
const ProfitabilityPage = lazy(() => import('./pages/recipes/RecipesPages.jsx').then((module) => ({ default: module.ProfitabilityPage })))
const PurchasesPage = lazy(() => import('./pages/purchases/PurchasesPage.jsx').then((module) => ({ default: module.PurchasesPage })))
const FinanceLayout = lazy(() => import('./pages/finance/FinanceLayout.jsx').then((module) => ({ default: module.FinanceLayout })))
const FinanceOverviewPage = lazy(() => import('./pages/finance/FinanceOverviewPage.jsx').then((module) => ({ default: module.FinanceOverviewPage })))
const ReportsPage = lazy(() => import('./pages/finance/ReportsPage.jsx').then((module) => ({ default: module.ReportsPage })))
const JournalPage = lazy(() => import('./pages/finance/JournalPage.jsx').then((module) => ({ default: module.JournalPage })))
const LedgerPage = lazy(() => import('./pages/finance/LedgerPage.jsx').then((module) => ({ default: module.LedgerPage })))
const AccountsPage = lazy(() => import('./pages/finance/AccountsPage.jsx').then((module) => ({ default: module.AccountsPage })))
const ExpensesPage = lazy(() => import('./pages/ExpensesPage.jsx').then((module) => ({ default: module.ExpensesPage })))
const AdvisorPage = lazy(() => import('./pages/analytics/AdvisorPage.jsx').then((module) => ({ default: module.AdvisorPage })))
const SalesForecastPage = lazy(() => import('./pages/analytics/SalesForecastPage.jsx').then((module) => ({ default: module.SalesForecastPage })))
const CustomerAnalyticsPage = lazy(() => import('./pages/analytics/CustomerAnalyticsPage.jsx').then((module) => ({ default: module.CustomerAnalyticsPage })))
const DailybrewHelpPage = lazy(() => import('./pages/help/DailybrewHelpPages.jsx').then((module) => ({ default: module.DailybrewHelpPage })))
const DailybrewTicketPage = lazy(() => import('./pages/help/DailybrewHelpPages.jsx').then((module) => ({ default: module.DailybrewTicketPage })))
const SuppliersPage = lazy(() => import('./pages/purchases/SuppliersPage.jsx').then((module) => ({ default: module.SuppliersPage })))

/** Rute owner — dipakai aplikasi asli dan pratinjau dev. */
function ownerRoutes() {
  return (
    <>
      <Route index element={<DashboardPage />} />
      <Route path="products" element={<ProductsPage />} />
      <Route path="categories" element={<CategoriesPage />} />
      <Route path="orders" element={<OrdersPage />} />
      <Route path="cashier" element={<CashierReportPage />} />
      <Route path="payments" element={<OnlinePaymentsPage />} />
      <Route path="inventory" element={<InventoryLayout />}>
        <Route index element={<IngredientsPage />} />
        <Route path="movements" element={<MovementsPage />} />
        <Route path="counts" element={<StockCountPage />} />
        <Route path="forecast" element={<ForecastPage />} />
      </Route>
      <Route path="recipes" element={<RecipesLayout />}>
        <Route index element={<ProductCostingPage />} />
        <Route path="profit" element={<ProfitabilityPage />} />
      </Route>
      <Route path="purchases" element={<PurchasesPage />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="finance" element={<FinanceLayout />}>
        <Route index element={<FinanceOverviewPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="journal" element={<JournalPage />} />
        <Route path="ledger" element={<LedgerPage />} />
        <Route path="accounts" element={<AccountsPage />} />
      </Route>
      <Route path="expenses" element={<ExpensesPage />} />
      <Route path="loyalty" element={<LoyaltyPage />} />
      <Route path="promotions" element={<PromotionsPage />} />
      <Route path="reviews" element={<ReviewsPage />} />
      <Route path="support" element={<SupportPage />} />
      <Route path="bantuan" element={<DailybrewHelpPage />} />
      <Route path="bantuan/:ticketId" element={<DailybrewTicketPage />} />
      <Route path="advisor" element={<AdvisorPage />} />
      <Route path="sales-forecast" element={<SalesForecastPage />} />
      <Route path="customer-analytics" element={<CustomerAnalyticsPage />} />
      <Route path="team" element={<TeamLayout />}>
        <Route index element={<MembersPage />} />
        <Route path="shifts" element={<ShiftsPage />} />
        <Route path="activity" element={<ActivityPage />} />
      </Route>
      <Route path="settings" element={<SettingsLayout />}>
        <Route index element={<GeneralSettings />} />
        <Route path="operations" element={<OperationsSettings />} />
        <Route path="charges" element={<ChargesSettings />} />
        <Route path="ordering" element={<OrderingSettings />} />
        <Route path="payments" element={<PaymentSettings />} />
        <Route path="subscription" element={<SubscriptionSettings />} />
        <Route path="tables" element={<TablesSettings />} />
        <Route path="receipt" element={<ReceiptSettings />} />
        <Route path="appearance" element={<AppearanceSettings />} />
      </Route>
    </>
  )
}
const StaffLayout = lazy(() =>
  import('./components/StaffLayout.jsx').then((module) => ({ default: module.StaffLayout })),
)
const StaffBoardPage = lazy(() =>
  import('./pages/StaffBoardPage.jsx').then((module) => ({ default: module.StaffBoardPage })),
)
const StaffHistoryPage = lazy(() =>
  import('./pages/StaffHistoryPage.jsx').then((module) => ({ default: module.StaffHistoryPage })),
)
const PosPage = lazy(() => import('./pages/staff/PosPage.jsx').then((module) => ({ default: module.PosPage })))
const CashierPage = lazy(() => import('./pages/staff/CashierPage.jsx').then((module) => ({ default: module.CashierPage })))
const CashierReportPage = lazy(() => import('./pages/CashierReportPage.jsx').then((module) => ({ default: module.CashierReportPage })))
const StaffMenuPage = lazy(() =>
  import('./pages/StaffMenuPage.jsx').then((module) => ({ default: module.StaffMenuPage })),
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
        {StaffPreview && (
          <Route path="/preview/staff" element={<StaffPreview />}>
            <Route index element={<StaffBoardPage />} />
            <Route path="pos" element={<PosPage />} />
            <Route path="cashier" element={<CashierPage />} />
            <Route path="history" element={<StaffHistoryPage />} />
            <Route path="menu" element={<StaffMenuPage />} />
            <Route path="support" element={<StaffSupportPage />} />
          </Route>
        )}
        {OwnerPreview && (
          <Route path="/preview/owner" element={<OwnerPreview />}>
            {ownerRoutes()}
          </Route>
        )}
        <Route element={<RequireAuth />}>
          <Route path="staff" element={<StaffLayout />}>
            <Route index element={<StaffBoardPage />} />
            <Route path="pos" element={<PosPage />} />
            <Route path="cashier" element={<CashierPage />} />
            <Route path="history" element={<StaffHistoryPage />} />
            <Route path="menu" element={<StaffMenuPage />} />
            <Route path="support" element={<StaffSupportPage />} />
          </Route>
          <Route element={<OwnerLayout />}>
            {ownerRoutes()}
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
