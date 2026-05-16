export const config = { runtime: 'nodejs' }

import { withSentry } from '../_lib/sentry.js'
// Manual content_piece creation. Used when an editor (Philip or anyone)
// wants to spin up a brief for a moment AI didn't surface — the
// "always-have-a-backdoor" override path. Brand-scoped.

import { requireRole } from '../_lib/auth.js'
import { STAFF_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Brief creation is the same gate as media metadata edits — admin/publisher.
  const auth = await requireRole(req, STAFF_ROLES)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const sourceAssetId = body.sourceAssetId
  if (!sourceAssetId) return res.status(400).json({ error: 'sourceAssetId required' })

  const scope = await workspaceScope(req)

  // Verify the source belongs to this workspace before linking a brief to it.
  const lookup = await sb(`media_assets?id=eq.${sourceAssetId}&${scope.column}=eq.${scope.id}&select=id`)
  if (!lookup.ok) return res.status(500).json({ error: 'Database error' })
  const rows = await lookup.json()
  if (!rows[0]) return res.status(404).json({ error: 'Source asset not found' })

  const row = {
    [scope.column]: scope.id,
    source_asset_id: sourceAssetId,
    source_quote: body.sourceQuote || null,
    source_trim_start: body.sourceTrimStart ?? null,
    source_trim_end: body.sourceTrimEnd ?? null,
    target_platform: body.targetPlatform || null,
    final_caption: body.caption || null,
    final_hashtags: body.hashtags || [],
    final_cta_text: body.ctaText || null,
    final_cta_url: body.ctaUrl || null,
    notes: body.notes || null,
    assigned_to: body.assignedTo || null,
    status: 'accepted',  // manual creates skip the suggested → accepted hop
    accepted_at: new Date().toISOString(),
  }

  const r = await sb('content_pieces', { method: 'POST', body: JSON.stringify(row) })
  if (!r.ok) {
    const text = await r.text()
    return res.status(500).json({ error: 'Insert failed', detail: text })
  }
  const data = await r.json()
  return res.status(200).json(data[0] ?? null)
}

export default withSentry(handler)
