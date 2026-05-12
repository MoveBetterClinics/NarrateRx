// Browser Sentry init. Gated on import.meta.env.PROD so the dev console
// stays quiet — local errors should surface via the React ErrorBoundary
// and the network tab, not a third-party reporter.
//
// VITE_SENTRY_DSN must be set on the Vercel narraterx project (Production +
// Preview) for this to do anything. Missing DSN is a no-op (safer than a
// throw — Sentry should never be load-bearing).
//
// PII posture: Clerk emails and any interview/patient strings are NOT sent.
// We attach { userId, workspaceSlug, route } to the scope and rely on
// sendDefaultPii=false to suppress IP and cookie capture.

import * as Sentry from '@sentry/react'

let initialized = false

export function initSentry() {
  if (initialized) return
  if (!import.meta.env.PROD) return
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user?.email) delete event.user.email
      if (event.user?.ip_address) delete event.user.ip_address
      return event
    },
  })
  initialized = true
}

export function setSentryUser(userId) {
  if (!initialized) return
  Sentry.setUser(userId ? { id: userId } : null)
}

export function setSentryWorkspace(slug) {
  if (!initialized) return
  Sentry.setTag('workspace', slug || 'none')
}

export { Sentry }
