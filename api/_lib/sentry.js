// Shared Sentry wrapper for serverless handlers.
//
// Usage:
//
//   import { withSentry } from '../_lib/sentry.js'
//   async function handler(req, res) { ... }
//   export default withSentry(handler)
//
// One wrapper per handler, no duplicated try/catch in handler bodies.
// Existing console.error calls stay — Sentry is additive, not a replacement.
//
// PII posture: we attach userId + workspace slug + route to the scope.
// We never attach request bodies, headers, query strings, or Clerk user
// email — those can contain patient strings / personal addresses that
// the no-PII rule covers.
//
// Edge-runtime handlers (`export const config = { runtime: 'edge' }`) must
// NOT import this file — @sentry/node pulls in Node built-ins that don't
// resolve under the Edge runtime. Wrap those manually with a try/catch and
// rely on Vercel's own log capture, or migrate them to Fluid Compute.

import * as Sentry from '@sentry/node'

let initialized = false

function init() {
  if (initialized) return
  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    initialized = true
    return
  }
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  })
  initialized = true
}

function routeFromReq(req) {
  try {
    const url = req?.url || ''
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]
    return path || 'unknown'
  } catch {
    return 'unknown'
  }
}

// Set context fields populated by upstream helpers. requireRole attaches
// req.clerk = { userId, role, orgId }; workspaceContext callers commonly
// stash the row on req.workspace. Both are best-effort — absent values
// just mean we send less context, not that we fail.
function applyScope(scope, req) {
  scope.setTag('route', routeFromReq(req))
  scope.setTag('method', req?.method || 'unknown')
  const userId = req?.clerk?.userId
  if (userId) scope.setUser({ id: userId })
  const role = req?.clerk?.role
  if (role) scope.setTag('role', role)
  const ws = req?.workspace
  if (ws?.slug) scope.setTag('workspace', ws.slug)
  if (ws?.id) scope.setTag('workspace_id', ws.id)
}

export function withSentry(handler) {
  return async function wrappedHandler(req, res) {
    init()
    try {
      return await handler(req, res)
    } catch (err) {
      try {
        Sentry.withScope((scope) => {
          applyScope(scope, req)
          Sentry.captureException(err)
        })
        await Sentry.flush(2000)
      } catch {
        // Sentry should never crash the request path.
      }
      console.error(`[${routeFromReq(req)}] unhandled:`, err?.stack || err?.message || err)
      if (res && !res.headersSent) {
        try {
          return res.status(500).json({ error: 'internal-error' })
        } catch {
          // ignore
        }
      }
      throw err
    }
  }
}

export function captureServerException(err, req) {
  init()
  try {
    Sentry.withScope((scope) => {
      applyScope(scope, req)
      Sentry.captureException(err)
    })
  } catch {
    // ignore
  }
}
