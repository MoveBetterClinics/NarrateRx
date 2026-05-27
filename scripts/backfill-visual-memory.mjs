#!/usr/bin/env node
/**
 * NarrateRx Visual Memory Backfill
 *
 * One-off script that backfills the `visual_memory_chunks` table from
 * existing `media_assets` rows. Lets Phase 2's clip-pull AI retrieve
 * relevant clips from media uploaded before the Capture Companion existed.
 *
 * As of 2026-05-27:
 *   movebetter-people: 572 assets (538 with ai_tags, 212 with visual_narrative)
 *   movebetter-equine: 264 assets (264 with ai_tags)
 *   movebetter-animals: 103 assets (103 with ai_tags)
 *   studio: 1 asset
 *   Total: ~940 assets to embed. Cost: ~$0.003 (text-embedding-3-small).
 *
 * Usage:
 *   node scripts/backfill-visual-memory.mjs                             # all workspaces
 *   node scripts/backfill-visual-memory.mjs --workspace=movebetter-people
 *   node scripts/backfill-visual-memory.mjs --limit=10                  # cap for testing
 *   node scripts/backfill-visual-memory.mjs --dry-run                   # no embeds, no writes
 *   node scripts/backfill-visual-memory.mjs --batch=25                  # batch size (default 50)
 *   node scripts/backfill-visual-memory.mjs --skip-indexed              # skip assets already in visual_memory_chunks
 *
 * Required env (from .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY
 *
 * Idempotent — visualMemoryIndex upserts (deletes existing chunks for the
 * same source then inserts fresh). Re-running converges on the same state.
 */

import { readFile } from 'node:fs/promises'
import { indexMediaAsset } from '../api/_lib/visualMemoryIndex.js'

// ── env ──────────────────────────────────────────────────────────────────────
const envText = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const args = process.argv.slice(2)
const WORKSPACE_SLUG = args.find(a => a.startsWith('--workspace='))?.split('=')[1] ?? null
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0', 10)
const BATCH = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] ?? '50', 10)
const DRY_RUN = args.includes('--dry-run')
const SKIP_INDEXED = args.includes('--skip-indexed')

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`✗ Missing or redacted env: ${k}`)
    process.exit(1)
  }
}
if (!DRY_RUN && (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('REDACTED'))) {
  console.error(`✗ Missing or redacted env: OPENAI_API_KEY (required unless --dry-run)`)
  process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// ── Supabase helpers ─────────────────────────────────────────────────────────
function sb(path, init = {}) {
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
async function sbGet(path) {
  const r = await sb(path)
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${path}`)
  return r.json()
}

// ── Resolve workspaces ───────────────────────────────────────────────────────
console.log('\n📦 NarrateRx Visual Memory Backfill')
console.log(`   ${DRY_RUN ? 'DRY RUN' : 'LIVE'} • batch=${BATCH}${LIMIT ? ` • limit=${LIMIT}` : ''}${WORKSPACE_SLUG ? ` • workspace=${WORKSPACE_SLUG}` : ''}${SKIP_INDEXED ? ' • skip-indexed' : ''}`)

const wsFilter = WORKSPACE_SLUG ? `slug=eq.${WORKSPACE_SLUG}&` : ''
const workspaces = await sbGet(`workspaces?${wsFilter}select=id,slug,display_name`)
if (!workspaces.length) { console.error('No workspaces found'); process.exit(1) }
const wsBySlug = Object.fromEntries(workspaces.map(w => [w.id, w.slug]))
const wsIds = workspaces.map(w => `"${w.id}"`).join(',')
console.log(`   Scope: ${workspaces.map(w => w.slug).join(', ')}`)

// ── Build the asset query ────────────────────────────────────────────────────
// Fetch only the columns we need. Skip archived. Order by created_at desc so
// recent content gets indexed first (more likely to be referenced soon).
let assetPath = `media_assets?workspace_id=in.(${wsIds})&archived_at=is.null` +
  `&select=id,workspace_id&order=created_at.desc`
if (LIMIT > 0) assetPath += `&limit=${LIMIT}`

const assets = await sbGet(assetPath)
console.log(`   Eligible media_assets: ${assets.length}`)

// Filter out already-indexed if requested.
let toProcess = assets
if (SKIP_INDEXED && assets.length) {
  const chunks = await sbGet(
    `visual_memory_chunks?source_type=eq.media_asset&select=source_id`,
  )
  const indexed = new Set(chunks.map(c => c.source_id))
  toProcess = assets.filter(a => !indexed.has(a.id))
  console.log(`   Already indexed: ${assets.length - toProcess.length}, remaining: ${toProcess.length}`)
}

if (!toProcess.length) {
  console.log('\n✓ Nothing to do.')
  process.exit(0)
}

// ── Process in batches ───────────────────────────────────────────────────────
const stats = { ok: 0, failed: 0, dryRun: 0 }
const failures = []
const startedAt = Date.now()

async function processAsset(asset) {
  if (DRY_RUN) {
    // Just verify we can read the row + compose the embedding text.
    const r = await sb(
      `media_assets?id=eq.${asset.id}&select=id,filename,kind,ai_tags,visual_narrative,clinician_id`,
    )
    if (!r.ok) {
      stats.failed++
      failures.push({ id: asset.id, reason: `fetch_${r.status}` })
      return
    }
    const rows = await r.json()
    const row = rows?.[0]
    if (!row) {
      stats.failed++
      failures.push({ id: asset.id, reason: 'not_found' })
      return
    }
    stats.dryRun++
    return
  }

  const result = await indexMediaAsset({ assetId: asset.id })
  if (result.ok) {
    stats.ok++
  } else {
    stats.failed++
    failures.push({ id: asset.id, reason: result.reason })
  }
}

console.log(`\n⏳ Processing ${toProcess.length} assets in batches of ${BATCH}…`)
let cursor = 0
while (cursor < toProcess.length) {
  const batch = toProcess.slice(cursor, cursor + BATCH)
  await Promise.all(batch.map(processAsset))
  cursor += batch.length
  const pct = Math.round((cursor / toProcess.length) * 100)
  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  console.log(`   ${cursor}/${toProcess.length} (${pct}%)  ok=${stats.ok} dry=${stats.dryRun} failed=${stats.failed}  ${elapsed}s`)
}

// ── Summary ──────────────────────────────────────────────────────────────────
const totalSec = Math.round((Date.now() - startedAt) / 1000)
console.log(`\n✓ Done in ${totalSec}s`)
console.log(`   ok=${stats.ok}  dry=${stats.dryRun}  failed=${stats.failed}`)

if (failures.length) {
  console.log('\n✗ Failures (first 20):')
  for (const f of failures.slice(0, 20)) {
    console.log(`   ${f.id}  ${f.reason}`)
  }
  if (failures.length > 20) {
    console.log(`   …and ${failures.length - 20} more`)
  }
}

// Verify final state.
if (!DRY_RUN) {
  const chunks = await sbGet(
    `visual_memory_chunks?source_type=eq.media_asset&select=count`,
  )
  // PostgREST returns count via the Content-Range header normally; here we
  // just count the array length as a sanity check.
  console.log(`\n📊 visual_memory_chunks rows (media_asset source): ${chunks.length}`)
}

process.exit(stats.failed > 0 ? 1 : 0)
