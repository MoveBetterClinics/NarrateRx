// Every request carries a short-lived Clerk JWT in the Authorization header.
// requireRole() on the server-side endpoints verifies it and the matching
// workspaceScope() filter keeps tenants isolated. window.Clerk is the official
// browser handle exposed by @clerk/clerk-react.
//
// Same pattern as src/lib/contentLib.js / mediaLib.js / collectionsLib.js — we
// don't depend on Clerk's hooks here so this wrapper stays usable from non-
// component code.
//
// What this wrapper adds on top of plain fetch (2026-05-11):
//   - Automatic Clerk Bearer attachment.
//   - One retry on 5xx + network errors with linear backoff. GET/HEAD are
//     retried freely; mutating methods are retried only on network errors
//     (where the request likely never reached the server) and never on 5xx
//     (where the request may have partially applied).
//   - Typed ApiError with status code + JSON body so callers can branch on
//     auth/forbidden/conflict without parsing message strings.
//   - 401 short-circuit: when the server says the session is invalid, ask
//     Clerk to refresh and retry once before surfacing the failure.

export class ApiError extends Error {
  constructor(message, { status, body, isNetwork = false } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status ?? null
    this.body = body ?? null
    this.isNetwork = isNetwork
  }
}

async function getClerkToken({ refresh = false } = {}) {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.(refresh ? { skipCache: true } : undefined)
  } catch {
    return null
  }
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

async function rawFetch(path, init, { refreshToken = false } = {}) {
  const token = await getClerkToken({ refresh: refreshToken })
  const headers = { ...(init.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(path, { ...init, headers })
}

async function readJsonSafe(res) {
  try { return await res.json() } catch { return null }
}

async function apiFetch(path, init = {}) {
  const method = (init.method || 'GET').toUpperCase()
  const idempotent = IDEMPOTENT_METHODS.has(method)

  // Attempt #1
  let res
  try {
    res = await rawFetch(path, init)
  } catch (e) {
    // Network failure — retry once if idempotent, otherwise surface.
    if (idempotent) {
      await sleep(400)
      try {
        res = await rawFetch(path, init)
      } catch (e2) {
        throw new ApiError(e2?.message || 'Network error', { isNetwork: true })
      }
    } else {
      throw new ApiError(e?.message || 'Network error', { isNetwork: true })
    }
  }

  // 401 with a recent Clerk session may just mean the cached JWT expired.
  // Force-refresh and retry once before giving up.
  if (res.status === 401 && !init._retriedAuth) {
    const retried = await rawFetch(path, init, { refreshToken: true })
    if (retried.ok) return retried.json()
    res = retried
  }

  // Retry idempotent GETs once on 5xx (transient upstream errors).
  if (!res.ok && res.status >= 500 && idempotent) {
    await sleep(600)
    const retried = await rawFetch(path, init)
    if (retried.ok) return retried.json()
    res = retried
  }

  if (!res.ok) {
    const body = await readJsonSafe(res)
    const message = body?.error || `Request failed: ${res.status}`
    throw new ApiError(message, { status: res.status, body })
  }
  if (res.status === 204) return null
  return res.json()
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Clinicians ──────────────────────────────────────────────────────────────

export function fetchClinicians() {
  return apiFetch('/api/db/clinicians')
}

export function fetchClinician(id) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`)
}

export function getOrCreateClinician({ name, createdById, createdByEmail }) {
  return apiFetch('/api/db/clinicians', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, createdById, createdByEmail }),
  })
}

export function deleteClinician(id, userId) {
  return apiFetch(`/api/db/clinicians?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-user-id': userId },
  })
}

// ── Interviews ───────────────────────────────────────────────────────────────

export function fetchInterview(id) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`)
}

export function fetchSimilarInterviews(topic, excludeId) {
  const params = new URLSearchParams({ topic, excludeId })
  return apiFetch(`/api/db/interviews?${params}`)
}

export function createInterview({ clinicianId, topic, ownerId, ownerEmail, tone, voiceMode, prototypeId, locationId }) {
  return apiFetch('/api/db/interviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clinicianId, topic, ownerId, ownerEmail, tone, voiceMode, prototypeId, locationId }),
  })
}

export function updateInterview(id, patch, userId) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(patch),
  })
}

export function deleteInterview(id, userId) {
  return apiFetch(`/api/db/interviews?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-user-id': userId },
  })
}

// ── Campaign Settings ────────────────────────────────────────────────────────

export function fetchCampaign() {
  return apiFetch('/api/db/settings')
}

export function updateCampaign(patch, userId) {
  return apiFetch('/api/db/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(patch),
  })
}
