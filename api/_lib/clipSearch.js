// Shared clip-search helper for the Phase 2 Day 6-8 editorial pipeline.
//
// Both pull-clips (human-in-the-loop search) and generate-package (automated
// best-clip selection) need the same embed → RPC flow. This module centralises
// that logic so it doesn't need to be duplicated or maintained in two places.
//
// Callers: api/editorial/pull-clips.js, api/editorial/generate-package.js

import { embedTexts } from './embeddings.js'

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

/**
 * Search the workspace's visual memory for clips relevant to a topic.
 *
 * @param {Object} params
 * @param {string} params.query           — topic / prompt text
 * @param {string} params.workspaceId     — workspace to scope the search to
 * @param {number} [params.k=8]           — max clips to return (capped at 50)
 * @param {string} [params.kind]          — 'photo' | 'video' | null (= any)
 * @param {number} [params.minScore=0.5]  — cosine similarity threshold
 * @param {string} [params.staffId]   — optional clinician-scoped search
 *
 * @returns {Promise<Array>} shaped clip objects (camelCase)
 * @throws on embed failure or RPC failure
 */
export async function searchClips({
  query,
  workspaceId,
  k = 8,
  kind = null,
  minScore = 0.5,
  staffId = null,
}) {
  // Embed the query text
  const [queryEmbedding] = await embedTexts([query])
  if (!queryEmbedding || queryEmbedding.length !== 1536) {
    throw new Error('embedding_dim_mismatch')
  }

  // Call match_visual_memory_chunks RPC
  const rpcRes = await sb('rpc/match_visual_memory_chunks', {
    method: 'POST',
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      match_count: Math.min(Math.max(k, 1), 50),
      filter_workspace_id: workspaceId,
      filter_kind: kind || null,
      filter_min_score: minScore,
      filter_staff_id: staffId || null,
    }),
  })

  if (!rpcRes.ok) {
    const errText = await rpcRes.text().catch(() => '')
    throw new Error(`match_rpc_failed: ${rpcRes.status} ${errText.slice(0, 200)}`)
  }

  const rows = await rpcRes.json()

  return rows.map((r) => ({
    chunkId:         r.chunk_id,
    assetId:         r.source_id,
    similarity:      r.similarity,
    kind:            r.asset_kind,
    blobUrl:         r.asset_blob_url,
    thumbnailUrl:    r.asset_thumbnail_url,
    filename:        r.asset_filename,
    durationS:       r.asset_duration_s,
    aspectRatio:     r.asset_aspect_ratio,
    capturedAt:      r.asset_captured_at,
    visualNarrative: r.asset_visual_narrative,
    aiTags:          r.asset_ai_tags,
    audioQuality:    r.audio_quality,
    videoQuality:    r.video_quality,
    storyRole:       r.story_role,
    staffId:     r.staff_id,
  }))
}
