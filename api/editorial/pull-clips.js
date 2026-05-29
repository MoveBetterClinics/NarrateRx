// POST /api/editorial/pull-clips
//
// Phase 2 Day 6 of the 30-day video output build. Given a topic / blog
// title / atom prompt, returns the top-K visually-relevant clips from
// the workspace's visual practice memory. Backbone for Phase 2 Days 7-8
// (caption + render pipeline → story package generator).
//
// Body:
//   {
//     query: string,            // required — the topic / prompt text
//     k?: number,               // default 8, capped at 50
//     kind?: 'photo'|'video'|'any', // default 'any'
//     minScore?: number,        // default 0.5 — cosine similarity threshold
//     clinicianId?: string      // optional — scope to one clinician's captures
//   }
//
// Auth: Clerk JWT + workspace org-id check (workspaceContext).
// Workspace is inferred from the subdomain; cross-workspace queries are
// impossible by construction.
//
// Response 200:
//   {
//     query: string,
//     model: 'text-embedding-3-small',
//     clips: [{ chunkId, assetId, similarity, kind, blobUrl, thumbnailUrl,
//               filename, durationS, capturedAt, visualNarrative, aiTags, ... }]
//   }
//
// Errors: 400 (validation), 401/403 (auth), 404 (no workspace), 500 (db/embed)

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { searchClips } from '../_lib/clipSearch.js'

const DEFAULT_K = 8
const DEFAULT_MIN_SCORE = 0.5

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // --- Workspace + auth ---
  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // --- Validate body ---
  const body = req.body || {}
  const query = String(body.query || '').trim()
  if (!query) return res.status(400).json({ error: 'query_required' })
  if (query.length > 2000) return res.status(400).json({ error: 'query_too_long' })

  const k = Math.min(Math.max(parseInt(body.k, 10) || DEFAULT_K, 1), 50)
  const kind = body.kind && body.kind !== 'any' ? String(body.kind) : null
  if (kind && !['photo', 'video', 'audio'].includes(kind)) {
    return res.status(400).json({ error: 'invalid_kind' })
  }
  const minScore = typeof body.minScore === 'number'
    ? Math.min(Math.max(body.minScore, 0), 1)
    : DEFAULT_MIN_SCORE
  const clinicianId = body.clinicianId ? String(body.clinicianId) : null

  // --- Search visual memory via shared helper ---
  let clips
  try {
    clips = await searchClips({ query, workspaceId: ws.id, k, kind, minScore, clinicianId })
  } catch (e) {
    console.error('[editorial/pull-clips] search failed:', e?.message)
    return res.status(500).json({ error: 'search_failed', detail: e?.message })
  }

  return res.status(200).json({
    query,
    model: 'text-embedding-3-small',
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    requested: { k, kind: kind || 'any', minScore, clinicianId },
    clips,
  })
}
