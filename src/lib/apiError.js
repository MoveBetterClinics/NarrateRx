// Shared error handling for fetch() responses from our own /api routes.
//
// A 429 from the server means a rate-limit bucket (api/_lib/ratelimit.js)
// rejected the request. Surface a single explanatory toast — the calling
// code still throws so the page-level error path runs (spinners reset,
// in-flight UI clears), but the user-facing message is consistent.

import { toast } from '@/lib/toast'

let _last429At = 0

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

export async function throwApiError(response) {
  let payload = {}
  try { payload = await response.json() } catch { /* empty */ }

  if (response.status === 429) {
    // Debounce: a burst of parallel calls (e.g. ReviewPost firing three
    // generations in parallel) shouldn't stack three identical toasts.
    const now = Date.now()
    if (now - _last429At > 1500) {
      _last429At = now
      const retryAfter = response.headers.get('Retry-After')
      const description = retryAfter
        ? `Try again in ${retryAfter} second${retryAfter === '1' ? '' : 's'}.`
        : 'Try again in a few seconds.'
      toast.error("You're going faster than the limit", { description })
    }
    throw new Error(extractMessage(payload.message, payload.error) || 'Rate limited')
  }

  throw new Error(extractMessage(payload.error, payload.message) || `Request failed: ${response.status}`)
}
