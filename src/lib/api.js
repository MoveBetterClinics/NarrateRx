import { throwApiError } from '@/lib/apiError'

// Canonical fetch wrapper for our own /api routes. Routes error responses
// through throwApiError (rich 429 handling + payload.message/error parsing),
// guards the JSON success path so a 200-but-invalid-JSON body doesn't
// silently return undefined to callers (FUNC-01, PR #304).
export async function apiFetchResponse(path, init = {}) {
  const res = await fetch(path, init)
  if (!res.ok) await throwApiError(res)
  return res
}

export async function apiFetch(path, init = {}) {
  const res = await apiFetchResponse(path, init)
  return res.json().catch(() => { throw new Error(`Invalid JSON from ${path}`) })
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

export function suggestPullQuotes(interviewId) {
  return apiFetch('/api/interviews/pull-quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewId }),
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
