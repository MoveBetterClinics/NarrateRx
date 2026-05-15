import { apiFetch } from '@/lib/api'

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
