async function apiFetch(path, init = {}) {
  const res = await fetch(path, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`)
  return json
}

export function fetchContentPlanAtoms(interviewId) {
  return apiFetch(`/api/content-plan/atoms?interview_id=${encodeURIComponent(interviewId)}`)
}

export function updateAtomStatus(atomId, status) {
  return apiFetch(`/api/content-plan/atoms?id=${encodeURIComponent(atomId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

export function draftAtom(atomId) {
  return apiFetch('/api/content-plan/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ atom_id: atomId }),
  })
}
