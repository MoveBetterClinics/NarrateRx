// Index a media_asset into visual_memory_chunks for Phase 2 clip-pull retrieval.
//
// Called from the post-upload waitUntil pipeline in api/capture/upload.js and
// (eventually, Day 4 backfill) from scripts/backfill-visual-memory.mjs against
// every existing media_asset.
//
// Design notes:
//   • Idempotent — upserts by (workspace_id, source_type, source_id).
//   • Embedding source text is composed from already-stable fields on the
//     media_asset (filename, ai_tags, visual_narrative). If those fields are
//     empty or the row is unknown, we no-op rather than throw — the auto-tag
//     pipeline may not have completed yet, in which case visualMemoryIndex
//     gets retried later.
//   • Quality fields (audio_quality, video_quality) are stubbed at 1.0 for
//     Phase 1. Phase 2 adds a lightweight quality classifier on ingest.
//   • story_role stays NULL in Phase 1. Phase 2 adds the classifier.

import { embedTexts, EMBEDDING_DIMS } from './embeddings.js'

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
 * Compose the text that gets embedded for a media_asset.
 * Keep this stable — changing the composition invalidates existing embeddings.
 */
function composeEmbeddingText(asset, staffName = '') {
  const lines = []
  const kind = asset.kind || 'media'
  const filename = asset.filename || asset.blob_pathname || '(unnamed)'
  lines.push(`[capture] ${filename} (kind=${kind}${staffName ? `, captured by ${staffName}` : ''})`)

  if (asset.visual_narrative) {
    lines.push(`Visual: ${asset.visual_narrative}`)
  }

  // ai_tags shape from tagAsset.js is currently a flat array of tag strings.
  // Be defensive — accept array of strings, array of {tag, ...} objects, or jsonb.
  if (asset.ai_tags) {
    const tagsArr = Array.isArray(asset.ai_tags) ? asset.ai_tags : []
    const tags = tagsArr
      .map((t) => (typeof t === 'string' ? t : t?.tag || t?.label || ''))
      .filter(Boolean)
      .join(', ')
    if (tags) lines.push(`Tags: ${tags}`)
  }

  if (asset.alt_text) lines.push(`Alt: ${asset.alt_text}`)
  if (asset.notes) lines.push(`Notes: ${asset.notes}`)
  if (asset.condition) lines.push(`Condition: ${asset.condition}`)

  return lines.join('\n')
}

/**
 * Best-effort fetch of clinician display name for richer embedding context.
 */
async function getStaffName(staffId) {
  if (!staffId) return ''
  try {
    const r = await sb(`staff?id=eq.${staffId}&select=name`)
    if (!r.ok) return ''
    const rows = await r.json()
    return rows?.[0]?.name || ''
  } catch {
    return ''
  }
}

/**
 * Index (or re-index) a media_asset into visual_memory_chunks.
 *
 * @param {Object} params
 * @param {string} params.assetId — media_assets.id
 * @returns {Promise<{ok: boolean, chunkId?: string, reason?: string}>}
 */
export async function indexMediaAsset({ assetId }) {
  if (!assetId) return { ok: false, reason: 'missing_asset_id' }

  // 1. Fetch the media_asset row.
  const assetRes = await sb(
    `media_assets?id=eq.${assetId}&select=id,workspace_id,staff_id,kind,filename,blob_pathname,ai_tags,visual_narrative,alt_text,notes,condition,source,captured_at`,
  )
  if (!assetRes.ok) {
    return { ok: false, reason: `fetch_asset_failed_${assetRes.status}` }
  }
  const rows = await assetRes.json()
  const asset = rows?.[0]
  if (!asset) return { ok: false, reason: 'asset_not_found' }

  // 2. Compose embedding text. If too sparse, defer.
  const staffName = await getStaffName(asset.staff_id)
  const text = composeEmbeddingText(asset, staffName)
  if (!text || text.length < 16) {
    return { ok: false, reason: 'text_too_sparse' }
  }

  // 3. Generate embedding (OpenAI text-embedding-3-small, 1536 dims).
  let embedding
  try {
    const [vec] = await embedTexts([text])
    if (!vec || vec.length !== EMBEDDING_DIMS) {
      return { ok: false, reason: 'embedding_dim_mismatch' }
    }
    embedding = vec
  } catch (e) {
    return { ok: false, reason: `embed_failed_${e?.message || 'unknown'}` }
  }

  // 4. Upsert into visual_memory_chunks. Idempotent via source_type+source_id.
  //    PostgREST upsert via Prefer: resolution=merge-duplicates needs a unique
  //    constraint on the conflict columns. We don't have one (yet), so do the
  //    delete-then-insert dance for now — safe because chunks are 1:1 with
  //    media_assets in Phase 1.
  const delRes = await sb(
    `visual_memory_chunks?source_type=eq.media_asset&source_id=eq.${assetId}`,
    { method: 'DELETE' },
  )
  if (!delRes.ok && delRes.status !== 404) {
    return { ok: false, reason: `delete_existing_failed_${delRes.status}` }
  }

  const insertRes = await sb('visual_memory_chunks', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: asset.workspace_id,
      staff_id: asset.staff_id,
      source_type: 'media_asset',
      source_id: assetId,
      source_blob_url: asset.blob_pathname || null,
      tags: { composed_from: 'media_asset', kind: asset.kind, source: asset.source },
      audio_quality: asset.kind === 'video' ? 1.0 : null,
      video_quality: 1.0,
      story_role: null,
      embedding: `[${embedding.join(',')}]`,
    }),
  })

  if (!insertRes.ok) {
    return { ok: false, reason: `insert_failed_${insertRes.status}` }
  }
  const inserted = await insertRes.json()
  return { ok: true, chunkId: inserted?.[0]?.id }
}
