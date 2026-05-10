async function apiFetch(path, init = {}) {
  const res = await fetch(path, init)
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error || `Request failed: ${res.status}`)
  }
  return res.json()
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
