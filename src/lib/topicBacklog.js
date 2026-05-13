async function apiFetch(path, init = {}) {
  const res = await fetch(path, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`)
  return json
}

export function fetchTopicBacklog(status) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  return apiFetch(`/api/topic-backlog${qs}`)
}

export function createTopic(payload) {
  return apiFetch('/api/topic-backlog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function updateTopic(id, patch) {
  return apiFetch(`/api/topic-backlog?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteTopic(id) {
  return apiFetch(`/api/topic-backlog?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function suggestTopics(count = 5) {
  return apiFetch('/api/topic-backlog/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  })
}
