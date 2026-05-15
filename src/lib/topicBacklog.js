// @ts-check
import { apiFetch } from '@/lib/api'

/** @param {string} [status] @returns {Promise<unknown>} */
export function fetchTopicBacklog(status) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  return apiFetch(`/api/topic-backlog${qs}`)
}

/** @param {Record<string, unknown>} payload @returns {Promise<unknown>} */
export function createTopic(payload) {
  return apiFetch('/api/topic-backlog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** @param {string} id @param {Record<string, unknown>} patch @returns {Promise<unknown>} */
export function updateTopic(id, patch) {
  return apiFetch(`/api/topic-backlog?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** @param {string} id @returns {Promise<unknown>} */
export function deleteTopic(id) {
  return apiFetch(`/api/topic-backlog?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** @param {number} [count] @returns {Promise<unknown>} */
export function suggestTopics(count = 5) {
  return apiFetch('/api/topic-backlog/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  })
}
