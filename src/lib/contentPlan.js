// @ts-check
import { apiFetch } from '@/lib/api'

/** @param {string} interviewId @returns {Promise<unknown>} */
export function fetchContentPlanAtoms(interviewId) {
  return apiFetch(`/api/content-plan/atoms?interview_id=${encodeURIComponent(interviewId)}`)
}

/** @param {string} atomId @param {string} status @returns {Promise<unknown>} */
export function updateAtomStatus(atomId, status) {
  return apiFetch(`/api/content-plan/atoms?id=${encodeURIComponent(atomId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

/** @param {string} atomId @returns {Promise<unknown>} */
export function draftAtom(atomId) {
  return apiFetch('/api/content-plan/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ atom_id: atomId }),
  })
}
