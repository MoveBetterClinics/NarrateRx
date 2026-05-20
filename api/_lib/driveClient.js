// Thin wrapper over Drive REST API v3 used by the list + import endpoints.
// All calls take a workspace_id and load + refresh the OAuth access token via
// accessTokenForWorkspace. Callers should catch DriveAuthError to surface a
// "reconnect required" prompt instead of a generic 5xx.

import { accessTokenForWorkspace } from './driveAuth.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Files we know how to import (server pipeline expects image/* or video/*).
// Google Docs / Sheets / Slides are excluded — they need an export, which
// we don't support yet (and they'd land in the Library as opaque blobs).
function buildMediaFilter() {
  return "(mimeType contains 'image/' or mimeType contains 'video/')"
}

function safeQuote(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

// List files + folders for either browse mode (`folderId` set, no query) or
// search mode (query set, scans the whole drive). The shape returned matches
// what the picker UI expects — folders first, then media, paginated via
// nextPageToken. The first call with no folderId defaults to 'root' (the
// user's My Drive root).
export async function listDrive({ workspaceId, folderId = 'root', query = '', pageToken = '', pageSize = 100 }) {
  const token = await accessTokenForWorkspace(workspaceId)
  const mediaFilter = buildMediaFilter()
  const isBrowse = !query.trim()

  const q = isBrowse
    ? `'${safeQuote(folderId)}' in parents and (mimeType = '${FOLDER_MIME}' or ${mediaFilter}) and trashed=false`
    : `${mediaFilter} and name contains '${safeQuote(query)}' and trashed=false`

  const params = new URLSearchParams({
    q,
    fields: 'nextPageToken,files(id,name,mimeType,size,thumbnailLink,iconLink,webViewLink,createdTime,modifiedTime,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis))',
    pageSize: String(Math.min(Math.max(pageSize, 1), 1000)),
    orderBy: isBrowse ? 'folder,name' : 'modifiedTime desc',
    // Include items from Shared Drives the user has access to. corpora=user
    // covers My Drive; allDrives also includes shared-with-me + shared drives.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    spaces: 'drive',
  })
  if (pageToken) params.set('pageToken', pageToken)

  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* empty */ }
    const message = parsed?.error?.message || `Drive API error ${r.status}`
    const err = new Error(message)
    err.status = r.status
    throw err
  }
  const data = await r.json()
  const raw = Array.isArray(data?.files) ? data.files : []

  const folders = []
  const files = []
  for (const f of raw) {
    if (f.mimeType === FOLDER_MIME) {
      folders.push({
        id: f.id,
        name: f.name,
        kind: 'folder',
      })
    } else {
      const isVideo = String(f.mimeType || '').startsWith('video/')
      files.push({
        id: f.id,
        name: f.name,
        kind: isVideo ? 'video' : 'image',
        mimeType: f.mimeType,
        size: f.size ? Number(f.size) : null,
        thumbnailUrl: f.thumbnailLink || null,
        iconUrl: f.iconLink || null,
        viewUrl: f.webViewLink || null,
        createdAt: f.createdTime || null,
        modifiedAt: f.modifiedTime || null,
        width:
          f.imageMediaMetadata?.width
            ?? f.videoMediaMetadata?.width
            ?? null,
        height:
          f.imageMediaMetadata?.height
            ?? f.videoMediaMetadata?.height
            ?? null,
        durationMs: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) : null,
      })
    }
  }

  return {
    folder: folderId,
    items: [...folders, ...files],
    nextPageToken: data.nextPageToken || null,
  }
}

// Fetch a single file's metadata. Used by the importer to learn the mime
// type / size / name authoritatively from Google rather than trusting what
// the client posted up.
export async function getDriveFile({ workspaceId, fileId, fields = 'id,name,mimeType,size' }) {
  const token = await accessTokenForWorkspace(workspaceId)
  const params = new URLSearchParams({
    fields,
    supportsAllDrives: 'true',
  })
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* empty */ }
    const err = new Error(parsed?.error?.message || `Drive API error ${r.status}`)
    err.status = r.status
    throw err
  }
  return await r.json()
}

// Download a file's bytes. Returns a Web Response so callers can stream the
// body to disk via Readable.fromWeb (see CLAUDE.md large-file rule — never
// await arrayBuffer() on media). Throws on non-2xx with .status set.
export async function downloadDriveFile({ workspaceId, fileId }) {
  const token = await accessTokenForWorkspace(workspaceId)
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* empty */ }
    const err = new Error(parsed?.error?.message || `Drive download failed (${r.status})`)
    err.status = r.status
    throw err
  }
  return r
}
