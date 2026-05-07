// Client-side helpers for content_pieces (a.k.a. "edit briefs"). Each piece
// is a draft post candidate surfaced from a source media row by the AI
// segmenter, OR created manually by an editor as a backdoor override.

async function api(path, init = {}) {
  const res = await fetch(path, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`)
  return json
}

export function listContentPieces({ status, platform, sourceId, assignedTo, limit, offset } = {}) {
  const params = new URLSearchParams()
  if (status)     params.set('status', status)
  if (platform)   params.set('platform', platform)
  if (sourceId)   params.set('sourceId', sourceId)
  if (assignedTo) params.set('assignedTo', assignedTo)
  if (limit)      params.set('limit', String(limit))
  if (offset)     params.set('offset', String(offset))
  const qs = params.toString()
  return api(`/api/content-pieces/list${qs ? `?${qs}` : ''}`)
}

export function getContentPiece(id) {
  return api(`/api/content-pieces/${encodeURIComponent(id)}`)
}

export function updateContentPiece(id, patch) {
  return api(`/api/content-pieces/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteContentPiece(id) {
  return api(`/api/content-pieces/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createContentPiece(payload) {
  return api(`/api/content-pieces/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// Trigger the AI segmenter manually for an existing tagged source asset.
export function segmentMediaAsset(id) {
  return api(`/api/media/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}
