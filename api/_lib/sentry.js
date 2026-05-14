// Sentry stubs + centralized handler error wrapper — 2026-05-14.
//
// Sentry was deferred (off-roadmap, no paying tenants yet). The @sentry/node
// SDK is uninstalled, but `withSentry` is retained as a plain try/catch
// wrapper because removing it would require unwrapping 35+ handlers and the
// behavior (console.error + 500 response on unhandled throws) is still
// useful on its own.
//
// To re-enable Sentry: restore the original implementation from PR #287
// (commit c1ccf57) and reinstall @sentry/node.

function routeFromReq(req) {
  try {
    const url = req?.url || ''
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]
    return path || 'unknown'
  } catch {
    return 'unknown'
  }
}

// Catches unhandled throws from the handler, logs them, and returns a 500
// if the response hasn't already been sent. No external reporter — just
// console.error, which surfaces in Vercel logs.
export function withSentry(handler) {
  return async function wrappedHandler(req, res) {
    try {
      return await handler(req, res)
    } catch (err) {
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

// Retained as a no-op for any caller that imported it.
export function captureServerException() {}
