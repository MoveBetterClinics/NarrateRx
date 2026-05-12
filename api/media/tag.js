import { withSentry } from '../_lib/sentry.js'
import { tagById } from '../_lib/tagAsset.js'
import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { enforceLimit } from '../_lib/ratelimit.js'

// Manual AI auto-tagging endpoint. POST { id } → vision + transcription via
// the Vercel AI Gateway. The shared logic lives in _lib/tagAsset.js so
// upload.js can call it directly via waitUntil without an HTTP roundtrip.
//
// Runs on Node (Fluid Compute) — same constraint as the rest of the media
// routes. Uses the (req, res) handler shape; req.body is auto-parsed.

// Explicit Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
export const config = { runtime: 'nodejs', maxDuration: 120 }

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Tagging mutates ai_tags + status — same gate as PATCH on the asset.
  const auth = await requireRole(req, ['admin', 'editor'])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media'))) return

  const id = req.body?.id
  if (!id) return res.status(400).json({ error: 'Missing id' })

  try {
    const scope = await workspaceScope(req)
    const row = await tagById(id, scope)
    return res.status(200).json(row)
  } catch (e) {
    const msg = e?.message || 'Tagging failed'
    const status = msg === 'Not found' ? 404 : 500
    return res.status(status).json({ error: msg })
  }
}

export default withSentry(handler)
