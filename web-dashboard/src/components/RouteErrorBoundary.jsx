import { Component } from 'react'

export class RouteErrorBoundary extends Component {
  state = { hasError: false, message: '' }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: String(error?.message || error) }
  }

  componentDidCatch(error, info) {
    console.error('Dashboard route failed to render', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="route-error" role="alert">
          <h1>Halaman tidak dapat ditampilkan</h1>
          <p>Terjadi kesalahan saat membuka halaman. Muat ulang untuk mencoba lagi.</p>
          {import.meta.env.DEV && this.state.message && <pre className="route-error-detail">{this.state.message}</pre>}
          <button type="button" onClick={() => window.location.reload()}>Muat ulang</button>
        </main>
      )
    }

    return this.props.children
  }
}
