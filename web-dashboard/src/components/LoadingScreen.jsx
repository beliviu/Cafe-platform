export function LoadingScreen({ label = 'Memuat...' }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
