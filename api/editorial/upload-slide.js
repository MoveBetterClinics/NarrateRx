// POST /api/editorial/upload-slide
//
// Stores a single client-rendered carousel slide (photo + on-screen text baked
// in) to Blob storage and returns its public URL. This is the missing link that
// made on-screen text vanish from published carousels: the per-slide freeform
// overlay (content_items.slides) was only ever drawn to a throwaway <canvas>
// for preview — never turned into a real image — so publish shipped the raw
// photos. The browser renders each slide with the same renderFreeformSlide()
// used for the preview, then POSTs the baked JPEG here.
//
// Deliberately does NOT create a media_assets row: these are derived publish
// artifacts, not Library originals (Library = publishing pool, not archive).
//
// Body: { pieceId, idx, sig, dataUrl }  — dataUrl is "data:image/jpeg;base64,…"
// Response 200: { url }
//
// Workspace-scoped, STAFF-gated (same bar as publishing a content item).

export const config = { runtime: 'nodejs' }

import { put as blobPut } from '@vercel/blob'
import { requireRole } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

// 1080×1080 JPEG renders run ~150–500KB; base64 inflates ~33%. Cap generously
// below the Node function body limit so a malformed/huge payload is rejected
// cleanly instead of crashing the function.
const MAX_BYTES = 8 * 1024 * 1024

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST only' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const pieceId = String(body.pieceId || '').trim()
  const idx = Number.isInteger(body.idx) ? body.idx : parseInt(body.idx, 10)
  const sig = String(body.sig || '').replace(/[^a-z0-9]/gi, '').slice(0, 32)
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : ''

  if (!pieceId) return res.status(400).json({ error: 'invalid_payload', message: 'pieceId required' })
  if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: 'invalid_payload', message: 'idx required' })
  if (!sig) return res.status(400).json({ error: 'invalid_payload', message: 'sig required' })

  const m = /^data:image\/jpe?g;base64,(.+)$/.exec(dataUrl)
  if (!m) return res.status(400).json({ error: 'invalid_payload', message: 'dataUrl must be a base64 image/jpeg data URL' })

  let buffer
  try {
    buffer = Buffer.from(m[1], 'base64')
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'dataUrl is not valid base64' })
  }
  if (!buffer.length) return res.status(400).json({ error: 'invalid_payload', message: 'empty image' })
  if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'too_large', message: 'rendered slide exceeds size limit' })

  // Path keyed by piece + slide index + content signature. addRandomSuffix:false
  // + allowOverwrite so re-rendering an unchanged slide is idempotent and a
  // changed slide (new sig) writes a fresh object.
  const pathname = `media/slides/${ws.slug}/${pieceId}/${idx}-${sig}.jpg`

  try {
    const { url } = await blobPut(pathname, buffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return res.status(200).json({ url })
  } catch (e) {
    console.error('[editorial/upload-slide] blob put failed:', e.stack || e.message)
    return res.status(502).json({ error: 'upload_failed', message: `Slide upload failed: ${e.message}` })
  }
}
