// POST /api/workspace/extract-brand-visual
//
// Phase 2 Day 9 of the 30-day video output build.
// Analyzes a sample of the workspace's photos with Claude Vision and writes
// the extracted brand_visual_identity to the workspaces row.
//
// This is a slow, AI-intensive operation (~20-60s for 20 photos). Call it:
//   • Once after initial media is uploaded (on-demand from Settings)
//   • After significant media additions to refresh the analysis
//
// Auth: EDITOR_ROLES (admin + publisher) only — this is a workspace config action.
//
// Body:
//   { sampleSize?: number }   // default 20, max 40
//
// Response 200:
//   { workspaceId, sampleCount, brandVisualIdentity, elapsedMs }
// Errors: 400 / 401 / 403 / 404 / 409 (no photos) / 500

export const config = { runtime: 'nodejs', maxDuration: 120 }

import { requireRole } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { analyzeBrandVisuals } from '../_lib/brandVisualAnalyzer.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MAX_SAMPLE_SIZE = 40

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

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const sampleSize = Math.min(
    Math.max(parseInt(body.sampleSize, 10) || 20, 1),
    MAX_SAMPLE_SIZE,
  )

  const started = Date.now()

  let brandVisualIdentity
  try {
    brandVisualIdentity = await analyzeBrandVisuals({ workspaceId: ws.id, sampleSize })
  } catch (e) {
    if (e.message?.includes('No photos')) {
      return res.status(409).json({
        error: 'no_photos',
        message: 'No photos with thumbnails found. Upload and process some photos first.',
      })
    }
    console.error('[extract-brand-visual] analysis failed:', e.message)
    return res.status(500).json({ error: 'analysis_failed', detail: e.message })
  }

  // Persist to workspace row
  const patchRes = await sb(`workspaces?id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ brand_visual_identity: brandVisualIdentity }),
  })
  if (!patchRes.ok) {
    const errText = await patchRes.text().catch(() => '')
    console.error('[extract-brand-visual] patch failed:', patchRes.status, errText)
    return res.status(500).json({ error: 'db_patch_failed' })
  }

  const elapsedMs = Date.now() - started

  return res.status(200).json({
    workspaceId: ws.id,
    sampleCount: brandVisualIdentity.sampleCount,
    brandVisualIdentity,
    elapsedMs,
  })
}
