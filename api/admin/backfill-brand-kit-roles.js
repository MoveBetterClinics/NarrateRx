// POST /api/admin/backfill-brand-kit-roles
// One-shot backfill: assigns brand_kit_roles for assets uploaded before
// auto-assign was wired into the upload webhook. Safe to run multiple times —
// never overwrites existing role assignments.
// Admin-only. Delete this file once the backfill is confirmed complete.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { requireRole } from '../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const AUTO_ASSIGN_MIN_CONFIDENCE = 0.75

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireRole(req, ['admin'])
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const r = await sb('brand_assets?select=id,workspace_id,ai_classification,original_filename&order=created_at.asc')
  if (!r.ok) return res.status(500).json({ error: 'Failed to fetch brand_assets', detail: await r.text() })
  const assets = await r.json()

  const results = []

  for (const asset of assets) {
    const top = asset.ai_classification?.role_candidates?.[0]
    if (!top || top.confidence < AUTO_ASSIGN_MIN_CONFIDENCE) continue

    const { workspace_id, id, original_filename } = asset

    const existingRes = await sb(
      `brand_kit_roles?workspace_id=eq.${encodeURIComponent(workspace_id)}&role=eq.${encodeURIComponent(top.role)}&select=id,asset_id&limit=1`
    )
    const existing = existingRes.ok ? await existingRes.json() : []

    if (existing.length > 0) {
      results.push({ file: original_filename, role: top.role, action: 'skipped', reason: 'slot filled' })
      continue
    }

    const assignRes = await sb(`brand_kit_roles?on_conflict=workspace_id,role`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        workspace_id,
        role: top.role,
        asset_id: id,
        assigned_by: null,
        assigned_at: new Date().toISOString(),
      }),
    })

    if (!assignRes.ok) {
      results.push({ file: original_filename, role: top.role, action: 'error', detail: await assignRes.text() })
    } else {
      results.push({ file: original_filename, role: top.role, action: 'assigned', confidence: top.confidence })
    }
  }

  const assigned = results.filter((r) => r.action === 'assigned').length
  const skipped  = results.filter((r) => r.action === 'skipped').length
  const errors   = results.filter((r) => r.action === 'error').length

  return res.status(200).json({ assigned, skipped, errors, results })
}
