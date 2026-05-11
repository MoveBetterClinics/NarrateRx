// Thin facade around @sentry/react. Initialization is a no-op when
// VITE_SENTRY_DSN is unset — local dev, previews without telemetry, and
// any environment that hasn't opted in stay clean.
//
// Wiring points:
//   - main.jsx calls initSentry() before React mounts.
//   - ErrorBoundary.componentDidCatch forwards uncaught render errors.
//   - useSaveAction surfaces caller-thrown errors via reportError() too,
//     so async/await failures land in the same dashboard as render throws.
//
// Why we wrap instead of importing Sentry directly at call sites:
//   - Single switch (the DSN env var) toggles all telemetry off in one place.
//   - Tests + non-browser entrypoints can stub a no-op without touching
//     every reporter.
//   - Lets us layer in Replay / Performance later without diffing call sites.

import * as Sentry from '@sentry/react'

let _initialized = false

export function initSentry() {
  if (_initialized) return
  const dsn = import.meta.env?.VITE_SENTRY_DSN
  if (!dsn) {
    // Loud-enough warning in dev so misconfigurations are findable, quiet
    // enough that production logs don't flood when telemetry is intentionally
    // off (apex/marketing site, preview builds, etc.).
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.info('[sentry] VITE_SENTRY_DSN not set; error telemetry disabled')
    }
    return
  }
  Sentry.init({
    dsn,
    environment: import.meta.env?.MODE || 'production',
    // Release defaults to the Vercel commit SHA so a regression can be traced
    // back to a specific deployment in the dashboard.
    release: import.meta.env?.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
    // Don't sample performance by default — performance traces are noisy and
    // the audit's quick-win was crash visibility, not perf monitoring. The
    // user can flip this on per-environment without code changes.
    tracesSampleRate: 0,
    // Drop a handful of expected-noise errors that don't represent real bugs.
    ignoreErrors: [
      // ResizeObserver loop errors are a browser quirk, not application code
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // Caller-cancelled fetch (route change while a request was in flight)
      'AbortError',
    ],
  })
  _initialized = true
}

// Tag an error with caller context (which surface threw, what action) before
// shipping it. Falls back to Sentry.captureException with no scope when the
// SDK isn't initialized — calls still no-op safely.
export function reportError(error, context = {}) {
  if (!error) return
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(context)) {
      if (k === 'level') scope.setLevel(v)
      else if (k === 'tags' && typeof v === 'object') scope.setTags(v)
      else scope.setExtra(k, v)
    }
    Sentry.captureException(error)
  })
}

export function setSentryUser(user) {
  if (!_initialized) return
  if (!user) {
    Sentry.setUser(null)
    return
  }
  Sentry.setUser({
    id: user.id,
    email: user.primaryEmailAddress?.emailAddress,
    username: user.username || undefined,
  })
}
