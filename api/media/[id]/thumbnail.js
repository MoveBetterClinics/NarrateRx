import { thumbnailById } from '../../_lib/thumbnail.js'
import { requireRole } from '../../_lib/auth.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'

// Manual / on-demand video thumbnail extraction.
//
// Routing: POST /api/media/:id/thumbnail
// Used for re-generating a poster frame on an existing video (e.g. backfill
// of pre-thumbnail uploads, or a user-triggered "redo" if the auto-extracted
// frame landed on a black flash). Originals are never modified — only the
// thumbnail blob and media_assets.thumbnail_url.
//
// Runs on Node (Fluid Compute) — needs ffmpeg-static + @vercel/blob server.

export const config = { maxDuration: 120 }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireRole(req, ['admin', 'editor'])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const url = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)
  const id = parts[parts.length - 2]
  if (!id) return res.status(400).json({ error: 'Missing id' })

  try {
    const scope = await workspaceScope(req)
    const thumbnailUrl = await thumbnailById(id, scope)
    return res.status(200).json({ thumbnail_url: thumbnailUrl })
  } catch (e) {
    const msg = e?.message || 'Thumbnail generation failed'
    const status = msg === 'Not found' ? 404 : msg === 'Not a video' ? 400 : 500
    return res.status(status).json({ error: msg })
  }
}
