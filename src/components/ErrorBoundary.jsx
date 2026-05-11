// Top-level error boundary so an uncaught render error stops short of a white
// screen. Catches synchronous render errors; async errors (rejected promises,
// fetch errors, event handler throws) still need their own try/catch +
// toast surfacing — that's what useSaveAction is for.
//
// Use one at the root (wraps the whole app) and optionally per-route if a
// single page should fail without taking out chrome.

import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface to console + (eventually) Sentry. Logging the component stack
    // makes it possible to locate the throw in production minified bundles.
    console.error('[ErrorBoundary] caught:', error, info?.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
  }

  reload = () => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    // Allow callers to render a custom fallback if they want one (e.g. a
    // per-route boundary that keeps chrome visible).
    if (typeof this.props.fallback === 'function') {
      return this.props.fallback({ error, reset: this.reset, reload: this.reload })
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full text-center space-y-4 border rounded-xl shadow-sm p-8 bg-card">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              The app hit an unexpected error. Reloading usually clears it. If it keeps happening, let us know.
            </p>
          </div>
          {error?.message && (
            <pre className="text-xs text-left bg-muted rounded p-3 overflow-x-auto max-h-32">
              {String(error.message)}
            </pre>
          )}
          <div className="flex items-center justify-center gap-2">
            <Button onClick={this.reset} variant="outline" size="sm">
              Try again
            </Button>
            <Button onClick={this.reload} size="sm">
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Reload
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
