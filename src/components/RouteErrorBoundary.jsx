// Per-route ErrorBoundary. Wraps each lazy route so a render throw on one
// page can't white-screen the whole app — chrome (Layout, header, nav)
// keeps rendering and the user can reload or navigate elsewhere.
//
// The top-level <ErrorBoundary> in App.jsx is still the last line of
// defence for throws outside of routes (Layout, Clerk providers, etc.).
// This boundary sits inside <Layout> and rendering bubbles up only if
// this one doesn't catch.

import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { captureException } from '@/lib/sentry'

export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Console log keeps the dev experience the same as the top-level
    // boundary. Sentry capture is required — the audit explicitly calls
    // out that silent swallowing isn't acceptable here.
    console.error('[RouteErrorBoundary] caught:', error, info?.componentStack)
    captureException(error, { componentStack: info?.componentStack })
  }

  reload = () => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="max-w-md mx-auto mt-12 text-center space-y-4 border rounded-xl shadow-sm p-8 bg-card">
        <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
          <p className="text-sm text-muted-foreground">
            Reloading usually clears it. If it keeps happening, let us know.
          </p>
        </div>
        {error?.message && (
          <pre className="text-xs text-left bg-muted rounded p-3 overflow-x-auto max-h-32">
            {String(error.message)}
          </pre>
        )}
        <Button onClick={this.reload} size="sm">
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Reload
        </Button>
      </div>
    )
  }
}
