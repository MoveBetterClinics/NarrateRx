// Thin wrapper over Drive REST API v3 used by the import endpoint.
//
// Browsing now happens client-side via Google Picker (see DriveImportPicker.jsx),
// which calls Google directly using a short-lived access token issued by
// /api/integrations/drive/picker-token. This file used to also expose a
// listDrive() helper for the server-side browser (PR #685); it was removed
// in PR #687 when we moved to drive.file scope, which can't list arbitrary
// folders — the access token only sees files the user has explicitly picked.
//
// Callers should catch DriveAuthError to surface a "reconnect required"
// prompt instead of a generic 5xx.

import { accessTokenForWorkspace } from './driveAuth.js'

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
//
// drive.file scope note: this works for files the user has picked via the
// Google Picker (which establishes the file→app relationship). A 404 on
// download with drive.file usually means the file ID wasn't actually
// picked by this user — most likely a client-side bug that's sending an
// ID from somewhere other than the Picker callback.
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
