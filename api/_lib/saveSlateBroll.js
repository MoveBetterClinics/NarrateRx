// Shared helper: save a rendered Slate clip as a b-roll media_assets row
// and kick off visual-memory indexing in the background.
//
// Called from:
//   • api/editorial/clip-to-broll.js  (new manual clip workshop output)
//   • api/editorial/approve-package.js library branch (existing package path)
//
// params:
//   {
//     ws         — workspace context object (must have .id)
//     renders    — Array<{ blobUrl, width, height, sizeBytes, channel? }>
//     staffId    — source staff_id (may be null)
//     notes      — human-readable provenance note
//     parentAssetId — source media_asset.id (for "clips cut" counter; nullable)
//   }
//
// Returns: Array of inserted media_assets rows.

import { waitUntil } from '@vercel/functions'
import { indexMediaAsset } from './visualMemoryIndex.js'

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

export async function saveSlateBroll({ ws, renders, staffId, notes, parentAssetId }) {
  const assetRows = renders.map((r) => {
    const isVideo = String(r.blobUrl || '').toLowerCase().endsWith('.mp4')
    const kind = isVideo ? 'video' : 'photo'
    const filename = (r.blobUrl || '').split('/').pop().split('?')[0] || `slate-broll.mp4`
    const blobPathname = (() => {
      try { return new URL(r.blobUrl).pathname } catch { return filename }
    })()
    return {
      workspace_id:     ws.id,
      kind,
      asset_purpose:    kind === 'video' ? 'broll' : 'photo',
      source:           'slate',
      status:           'approved',
      blob_url:         r.blobUrl,
      blob_pathname:    blobPathname,
      filename,
      mime_type:        isVideo ? 'video/mp4' : 'image/jpeg',
      width:            r.width  || null,
      height:           r.height || null,
      size_bytes:       r.sizeBytes || null,
      staff_id:         staffId || null,
      parent_asset_id:  parentAssetId || null,
      // Renders are already processed mp4s — skip Mux re-transcode.
      transcode_status: kind === 'video' ? 'skipped' : null,
      notes:            notes || null,
    }
  })

  const res = await sb('media_assets', {
    method: 'POST',
    body: JSON.stringify(assetRows),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`media_assets insert failed: ${res.status} ${text}`)
  }
  const assets = await res.json()

  // Index each new asset into visual memory for ranked Suggested media.
  // waitUntil keeps the Vercel instance alive past the HTTP response.
  waitUntil(Promise.allSettled(assets.map((a) => indexMediaAsset({ assetId: a.id }))))

  return assets
}
