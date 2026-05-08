// GET / PATCH / DELETE for a single content_piece (edit brief).
// Runs on Node (Fluid Compute). All brand-scoped.

import { requireRole } from '../_lib/auth.js'

// Per-method role requirements — mirrors /api/media/[id]:
//   GET    → any authenticated user
//   PATCH  → admin or editor (brief edits + status transitions)
//   DELETE → admin or editor (brief teardown)
const ROLE_REQUIREMENTS = {
  GET:    null,
  PATCH:  ['admin', 'editor'],
  DELETE: ['admin', 'editor'],
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function brandId() {
  return (process.env.BRAND || process.env.VITE_BRAND || 'people').toLowerCase()
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const SELECT =
  'id,brand,source_asset_id,source_trim_start,source_trim_end,source_quote,' +
  'ai_suggested_platform,ai_caption,ai_hashtags,ai_cta_text,ai_reasoning,' +
  'ai_model,ai_generated_at,final_caption,final_hashtags,final_cta_text,' +
  'final_cta_url,target_platform,final_asset_id,status,assigned_to,notes,' +
  'rejected_reason,created_at,updated_at,accepted_at,returned_at,' +
  'published_at,published_target_id'

export default async function handler(req, res) {
  if (!(req.method in ROLE_REQUIREMENTS)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const auth = await requireRole(req, ROLE_REQUIREMENTS[req.method])
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const url = new URL(req.url, 'http://localhost')
  const id  = url.pathname.split('/').pop()
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const where = `id=eq.${id}&brand=eq.${brandId()}`

  if (req.method === 'GET') {
    const r = await sb(`content_pieces?${where}&select=${SELECT}`)
    if (!r.ok) return res.status(500).json({ error: 'Database error' })
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'PATCH') {
    const patch = req.body || {}
    const allowed = {
      status:           patch.status,
      target_platform:  patch.targetPlatform,
      final_caption:    patch.finalCaption,
      final_hashtags:   patch.finalHashtags,
      final_cta_text:   patch.finalCtaText,
      final_cta_url:    patch.finalCtaUrl,
      assigned_to:      patch.assignedTo,
      notes:            patch.notes,
      rejected_reason:  patch.rejectedReason,
      source_trim_start: patch.sourceTrimStart,
      source_trim_end:  patch.sourceTrimEnd,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))

    // Status transitions stamp the relevant timestamp.
    if (patch.status === 'accepted')  body.accepted_at  = new Date().toISOString()
    if (patch.status === 'returned')  body.returned_at  = new Date().toISOString()
    if (patch.status === 'published') body.published_at = new Date().toISOString()
    if (patch.publishedTargetId !== undefined) body.published_target_id = patch.publishedTargetId

    const r = await sb(`content_pieces?${where}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const text = await r.text()
      return res.status(500).json({ error: 'Update failed', detail: text })
    }
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'DELETE') {
    const r = await sb(`content_pieces?${where}`, { method: 'DELETE' })
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' })
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
