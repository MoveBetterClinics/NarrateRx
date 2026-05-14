// Backfill brand_kit_roles for assets that were uploaded before auto-assign
// was added. Reads every brand_assets row that has role_candidates in
// ai_classification, and for each top candidate with confidence >= 0.75
// inserts into brand_kit_roles if the slot is empty.
//
// Run from the NarrateRx project root:
//   node scripts/backfill-brand-kit-roles.mjs
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local')
const env = readFileSync(envPath, 'utf8')
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '')
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const AUTO_ASSIGN_MIN_CONFIDENCE = 0.75

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local')
  process.exit(1)
}

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

async function main() {
  // Fetch all brand_assets that have role_candidates
  console.log('Fetching brand_assets with role_candidates...')
  const r = await sb('brand_assets?select=id,workspace_id,ai_classification,original_filename&order=created_at.asc')
  if (!r.ok) {
    console.error('Failed to fetch brand_assets:', r.status, await r.text())
    process.exit(1)
  }
  const assets = await r.json()
  console.log(`Found ${assets.length} total brand_assets`)

  const candidates = assets.filter((a) => {
    const top = a.ai_classification?.role_candidates?.[0]
    return top && top.confidence >= AUTO_ASSIGN_MIN_CONFIDENCE
  })
  console.log(`${candidates.length} assets have a top candidate with confidence >= ${AUTO_ASSIGN_MIN_CONFIDENCE}\n`)

  let assigned = 0
  let skipped = 0

  for (const asset of candidates) {
    const top = asset.ai_classification.role_candidates[0]
    const { workspace_id, id, original_filename } = asset

    // Check if the slot is already filled
    const existingRes = await sb(
      `brand_kit_roles?workspace_id=eq.${encodeURIComponent(workspace_id)}&role=eq.${encodeURIComponent(top.role)}&select=id,asset_id&limit=1`
    )
    const existing = existingRes.ok ? await existingRes.json() : []

    if (existing.length > 0) {
      console.log(`  SKIP  ${original_filename} → ${top.role} (slot already filled by asset ${existing[0].asset_id})`)
      skipped++
      continue
    }

    // Slot is empty — assign
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
      console.error(`  ERROR ${original_filename} → ${top.role}:`, assignRes.status, await assignRes.text())
    } else {
      console.log(`  AUTO  ${original_filename} → ${top.role} (confidence ${(top.confidence * 100).toFixed(0)}%)`)
      assigned++
    }
  }

  console.log(`\nDone. Assigned: ${assigned}, Skipped (slot filled): ${skipped}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
