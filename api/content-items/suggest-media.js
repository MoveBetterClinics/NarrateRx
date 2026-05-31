// POST /api/content-items/suggest-media
//
// The media→content matcher (Phase P0). Given a content_items draft id, returns
// ranked media candidates (photos + whole videos) for the producer to one-click
// attach. This is the draft→media direction of the same searchClips brain that
// api/editorial/pull-clips.js points the other way (clip→content).
//
// Ranking is topic/semantic relevance + "what's literally shown" (the asset's
// ai_tags / visual_narrative, already embedded in visual_memory_chunks). Per the
// locked design decisions we deliberately do NOT rank or warn on clinician/face
// match — any face is on-brand, and weak matches are simply rejectable (the
// producer doesn't pick them).
//
// Body:
//   { id: string }                  — content_items.id to suggest media for
//   { query: string }               — raw query override (manual "refine search")
//   optional: { k?, minScore?, kind? ('photo'|'video') }
//
// Auth: Clerk JWT + workspace org-id check (workspaceContext). Cross-workspace
// queries are impossible by construction — the draft fetch is filtered by
// workspace_id and searchClips is scoped to ws.id.
//
// Response 200: { query, model, workspaceId, clips: [...] }
// Errors: 400 (validation), 401/403 (auth), 404 (no workspace / draft), 500.
//
// NOTE: unlike pull-clips.js this is NOT gated on ws.video_pipeline_enabled —
// the photo path is the turnkey P0 win and must work regardless of that flag.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { searchClips } from '../_lib/clipSearch.js'
import { buildDraftMatchQuery } from '../_lib/draftMatchQuery.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_K = 8
// Permissive threshold: surface 3–5 options even for niche topics; the cards
// show similarity so the producer can judge, and weak picks are rejectable.
const DEFAULT_MIN_SCORE = 0.3

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  // --- Workspace + auth ---
  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // --- Resolve the query ---
  const body = req.body || {}
  const id = body.id ? String(body.id) : null
  let query = body.query ? String(body.query).trim() : ''

  // When an id is given (the common path), build the query from the draft.
  // The fetch is workspace-scoped, so a caller can't pull another tenant's row.
  if (id && !query) {
    const r = await sb(
      `content_items?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}&select=id,topic,content,platform&limit=1`,
    )
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      console.error(`[content-items/suggest-media] draft fetch failed ${r.status}: ${detail.slice(0, 200)}`)
      return res.status(500).json({ error: 'draft_fetch_failed' })
    }
    const rows = await r.json()
    const item = rows?.[0]
    if (!item) return res.status(404).json({ error: 'draft_not_found' })
    query = buildDraftMatchQuery(item)
  }

  if (!query) return res.status(400).json({ error: 'query_required' })
  if (query.length > 2000) query = query.slice(0, 2000)

  const k = Math.min(Math.max(parseInt(body.k, 10) || DEFAULT_K, 1), 50)
  const kind = body.kind && ['photo', 'video'].includes(body.kind) ? body.kind : null
  const minScore = typeof body.minScore === 'number'
    ? Math.min(Math.max(body.minScore, 0), 1)
    : DEFAULT_MIN_SCORE

  // --- Search the workspace's visual memory via the shared helper ---
  let clips
  try {
    clips = await searchClips({ query, workspaceId: ws.id, k, kind, minScore })
  } catch (e) {
    console.error('[content-items/suggest-media] search failed:', e?.message)
    return res.status(500).json({ error: 'search_failed', detail: e?.message })
  }

  return res.status(200).json({
    query,
    model: 'text-embedding-3-small',
    workspaceId: ws.id,
    clips,
  })
}
