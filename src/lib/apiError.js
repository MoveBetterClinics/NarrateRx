// Shared error handling for fetch() responses from our own /api routes.
//
// Routing failures through a single helper:
//   - 401 → "session expired" toast with a Reload action. Most calls in this
//     app inject a Clerk bearer token (see api.js), so a 401 means the token
//     was rejected (expired session, signed out in another tab, etc.) — not a
//     missing role. Used to be conflated with 403 in places (PRs #424, #427),
//     surfacing "Admin access required" when the real problem was auth.
//   - 429 → "going too fast" toast with Retry-After hint. Debounced so a
//     burst of parallel calls (e.g. ReviewPost firing three generations) only
//     stacks one toast.
//   - Everything else → throws ApiError with the server's payload.error /
//     payload.message. Callers can branch on `err.status` (403 for admin-only
//     pages, 404 for not-found, etc.) without redoing the status parsing.

import { toast } from '@/lib/toast'

let _last429At = 0
let _last401At = 0

// Coerce arbitrary payload values into a human-readable string. Servers
// occasionally return `{ error: { ... } }` (e.g. an AI SDK error whose
// `.message` was itself an object), and `new Error(obj)` would otherwise
// stringify to the literal "[object Object]" that the user sees in the UI.
function extractMessage(...candidates) {
  for (const v of candidates) {
    if (typeof v === 'string' && v.length > 0) return v
    if (v && typeof v === 'object') {
      if (typeof v.message === 'string' && v.message.length > 0) return v.message
      try { return JSON.stringify(v) } catch { /* fall through */ }
    }
  }
  return ''
}

// Error class that preserves the HTTP status so callers can branch on it
// (`if (err.status === 403)` instead of re-parsing the message string).
export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export async function throwApiError(response) {
  let payload = {}
  try { payload = await response.json() } catch { /* empty */ }

  const message = extractMessage(payload.error, payload.message)

  if (response.status === 401) {
    const now = Date.now()
    if (now - _last401At > 1500) {
      _last401At = now
      toast.error('Your session expired', {
        description: 'Sign in again to continue.',
        action: { label: 'Reload', onClick: () => window.location.reload() },
      })
    }
    throw new ApiError(message || 'Not signed in', 401, payload)
  }

  if (response.status === 429) {
    const now = Date.now()
    if (now - _last429At > 1500) {
      _last429At = now
      const retryAfter = response.headers.get('Retry-After')
      const description = retryAfter
        ? `Try again in ${retryAfter} second${retryAfter === '1' ? '' : 's'}.`
        : 'Try again in a few seconds.'
      toast.error("You're going faster than the limit", { description })
    }
    throw new ApiError(message || 'Rate limited', 429, payload)
  }

  throw new ApiError(message || `Request failed: ${response.status}`, response.status, payload)
}
