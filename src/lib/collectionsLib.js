// Client-side helpers for Collections — editorial groupings of media_assets.
// Mirrors the auth + transport pattern from mediaLib.js so every request
// carries a Clerk JWT and surfaces server errors as thrown Errors.

async function getClerkToken() {
  if (typeof window === 'undefined') return null
  try {
    return await window.Clerk?.session?.getToken?.()
  } catch {
    return null
  }
}

async function api(path, init = {}) {
  const token   = await getClerkToken()
  const headers = { ...(init.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res  = await fetch(path, { ...init, headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`)
  return json
}

export function listCollections({ status, kind, assetId, limit, offset } = {}) {
  const params = new URLSearchParams()
  if (status)  params.set('status', status)
  if (kind)    params.set('kind', kind)
  if (assetId) params.set('assetId', assetId)
  if (limit)   params.set('limit', String(limit))
  if (offset)  params.set('offset', String(offset))
  const qs = params.toString()
  return api(`/api/collections/list${qs ? `?${qs}` : ''}`)
}

export function getCollection(id) {
  return api(`/api/collections/${encodeURIComponent(id)}`)
}

export function createCollection({ name, description, kind, slug, coverAssetId } = {}) {
  return api('/api/collections/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, kind, slug, coverAssetId }),
  })
}

export function updateCollection(id, patch) {
  return api(`/api/collections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteCollection(id) {
  return api(`/api/collections/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// Add one or more assets to a collection. Idempotent — duplicates collapse
// onto the (collection_id, asset_id) composite key on the server.
export function addAssetsToCollection(collectionId, assetIds) {
  return api('/api/collections/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId, assetIds }),
  })
}

export function removeAssetFromCollection(collectionId, assetId) {
  const qs = new URLSearchParams({ collectionId, assetId }).toString()
  return api(`/api/collections/items?${qs}`, { method: 'DELETE' })
}

export function removeAssetsFromCollection(collectionId, assetIds) {
  return api('/api/collections/items', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId, assetIds }),
  })
}
