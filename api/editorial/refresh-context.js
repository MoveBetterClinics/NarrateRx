// POST /api/editorial/refresh-context
//
// Re-runs fetchFusedRagContext for a story package and PATCHes rag_context.
// Powers the "Re-read prior thinking" button in the Slate package card.
//
// Body: { packageId: string }
//
// Response 200: { packageId, ragContext }
// Errors: 400 / 401 / 403 / 404 / 500

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { fetchFusedRagContext } from '../_lib/ragFusion.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path, init = {}) {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const packageId = String(body.packageId || '').trim()
  if (!packageId) return res.status(400).json({ error: 'packageId_required' })

  // Fetch the package (workspace-scoped)
  const pkgRes = await sb(
    `story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}&select=id,topic,staff_id`
  )
  if (!pkgRes.ok) return res.status(500).json({ error: 'db_error' })
  const pkgRows = await pkgRes.json()
  if (!pkgRows.length) return res.status(404).json({ error: 'package_not_found' })
  const pkg = pkgRows[0]

  // Re-run fusion
  let ragContext
  try {
    const fused = await fetchFusedRagContext({
      topic: pkg.topic,
      workspaceId: ws.id,
      staffIds: pkg.staff_id ? [pkg.staff_id] : [],
    })
    ragContext = {
      practice_chunks: (fused.practiceChunks || []).map((c) => ({
        chunk_id: c.source_id + ':' + (c.chunk_index ?? 0),
        score: c.similarity,
        text_preview: String(c.text || '').slice(0, 200),
        source_label: c.source_label,
      })),
      visual_chunks: (fused.visualChunks || []).map((c) => ({
        chunk_id: c.chunkId,
        score: c.similarity,
        asset_id: c.assetId,
        kind: c.kind,
      })),
      query_expansion: fused.queryExpansion,
      fallback_reason: fused.fallbackReason,
      retrieved_at: new Date().toISOString(),
    }
  } catch (e) {
    console.error('[refresh-context] fetchFusedRagContext failed:', e.message)
    return res.status(500).json({ error: 'rag_failed', detail: e.message })
  }

  // Persist updated context
  const patchRes = await sb(`story_packages?id=eq.${packageId}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ rag_context: ragContext }),
  })
  if (!patchRes.ok) {
    const errText = await patchRes.text().catch(() => '')
    console.error('[refresh-context] patch failed:', patchRes.status, errText)
    return res.status(500).json({ error: 'db_patch_failed' })
  }

  return res.status(200).json({ packageId, ragContext })
}
