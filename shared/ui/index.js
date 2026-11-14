/*
 * @dailybrew/ui — design system bersama web owner, web staff, dan dashboard platform.
 * Impor dari sini (alias Vite "@dailybrew/ui"); stylesheet lewat "@dailybrew/ui/styles.css".
 * Aturan pemakaian: DESIGN.md di root repo.
 */
export { Button, IconButton } from './components/Button.jsx'
export { Badge, Tag } from './components/Badge.jsx'
export { Card, CardHeader } from './components/Card.jsx'
export { CountUp, Delta, KpiCard, StatCard } from './components/KpiCard.jsx'
export { Sparkline } from './components/Sparkline.jsx'
export { Skeleton, SkeletonRows, SkeletonText } from './components/Skeleton.jsx'
export { EmptyState, ErrorState } from './components/EmptyState.jsx'
export { Dialog, Drawer } from './components/Dialog.jsx'
export { ConfirmDialog } from './components/ConfirmDialog.jsx'
export { ToastProvider, useToast } from './components/ToastProvider.jsx'
export { Input, RupiahInput, SearchInput, Select, Switch, TextField } from './components/Fields.jsx'
export { SegmentedControl, Tabs } from './components/SegmentedControl.jsx'
export { CheckMark, PageHeader, Pagination, Progress, Table, Tooltip } from './components/Misc.jsx'
export { Menu } from './components/Menu.jsx'
export { useCountUp, useElementWidth, useSlidingIndicator } from './components/hooks.js'

export { LineChart } from './charts/LineChart.jsx'
export { BarChart, ColumnChart, StackedBarChart } from './charts/BarChart.jsx'
export { DonutChart } from './charts/DonutChart.jsx'
export { barPath, niceScale } from './charts/scale.js'

export { AppShell, BrandMark } from './shell/AppShell.jsx'
export { CommandPalette } from './shell/CommandPalette.jsx'
export { AppearancePanel } from './shell/AppearancePanel.jsx'

export {
  ACCENT_PRESETS, DEFAULT_ACCENT, DEFAULT_THEME_COLOR, THEME_GRADIENTS, THEME_PRESETS,
  applyTheme, buildTheme, contrast, deriveAccent, hexToOklch, isHex, mix, oklch, onColor,
} from './theme/theme.js'
export { THEME_PREFERENCES, setThemePreference, toggleThemeMode, useThemeMode } from './theme/themeMode.js'
export { RADIUS_OPTIONS, motionEnabled, setAppearance, useAppearance } from './theme/appearance.js'
