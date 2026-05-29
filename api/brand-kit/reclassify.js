// POST /api/brand-kit/reclassify
// Re-runs the brand asset classifier on every asset in the current workspace.
// Useful after classifier improvements to update existing rows without re-uploading.
// Admin/editor only. Runs inline (no waitUntil) — may take ~30s for large libraries.
export const config = { runtime: 'nodejs', maxDuration: 120 }

import { requireRole } from '../_lib/auth.js'
import { EDITOR_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import {
  parseFilenameTokens,
  scoreRoleCandidates,
  inferImageAttributes,
} from '../_lib/brandKitClassifier.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const scope = await workspaceScope(req)

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const r = await sb(
    `brand_assets?${scope.column}=eq.${scope.id}&select=id,blob_url,mime_type,original_filename,ai_classification`
  )
  if (!r.ok) return res.status(500).json({ error: 'Failed to fetch assets' })
  const assets = await r.json()

  let updated = 0
  let errors  = 0

  for (const asset of assets) {
    try {
      const filename       = asset.original_filename || asset.blob_url?.split('/').pop() || ''
      const filename_tokens = parseFilenameTokens(filename)

      let attrs = { width: null, height: null, has_alpha: null, shape: null, background: 'unknown', color_mode: 'unknown' }

      // Re-run sharp analysis for raster images (skip SVG and PDF — no useful pixel data)
      if (asset.mime_type?.startsWith('image/') && asset.mime_type !== 'image/svg+xml') {
        try {
          const buf = Buffer.from(await (await fetch(asset.blob_url)).arrayBuffer())
          attrs = await inferImageAttributes(buf, asset.mime_type)
        } catch (e) {
          console.error(`reclassify: ${filename} attr inference failed:`, e?.message)
        }
      }

      const assetForScoring = { ...attrs, filename_tokens, mime_type: asset.mime_type }
      const role_candidates = scoreRoleCandidates(assetForScoring)

      // Preserve any existing extracted_guidelines / extracted_style from brand book scan
      const existingCls = asset.ai_classification || {}
      const ai_classification = {
        ...existingCls,
        role_candidates,
      }

      const patch = {
        filename_tokens,
        ai_classification,
        width:       attrs.width,
        height:      attrs.height,
        has_alpha:   attrs.has_alpha,
        shape:       attrs.shape,
        background:  attrs.background,
        color_mode:  attrs.color_mode,
      }

      const upd = await sb(`brand_assets?id=eq.${asset.id}&${scope.column}=eq.${scope.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })

      if (upd.ok) updated++
      else {
        console.error(`reclassify: PATCH failed for ${asset.id}:`, upd.status)
        errors++
      }
    } catch (e) {
      console.error(`reclassify: error on asset ${asset.id}:`, e?.message)
      errors++
    }
  }

  return res.status(200).json({ total: assets.length, updated, errors })
}
