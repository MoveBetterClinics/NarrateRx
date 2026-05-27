#!/usr/bin/env node
// scripts/extract-brand-visual-identity.mjs
//
// One-time (and on-demand) brand visual identity extractor.
// Analyzes workspace photos with Claude Vision and writes the result to
// workspaces.brand_visual_identity.
//
// Usage (from project root):
//   node scripts/extract-brand-visual-identity.mjs
//   node scripts/extract-brand-visual-identity.mjs --slug=movebetter-people
//   node scripts/extract-brand-visual-identity.mjs --slug=movebetter-equine --sample=30
//   node scripts/extract-brand-visual-identity.mjs --dry-run
//   node scripts/extract-brand-visual-identity.mjs --all            # all workspaces
//
// Requires: MULTITENANT_DATABASE_URL, OPENAI_API_KEY, ANTHROPIC_API_KEY (or
//           AI Gateway equivalent) in .env.local

import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// ── Env loading ───────────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local')
try {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
} catch (e) {
  console.error('Could not load .env.local — ensure env vars are set:', e.message)
}

// Dynamic import AFTER env is loaded so SUPABASE_URL / OPENAI_API_KEY are set.
const { analyzeBrandVisuals } = await import('../api/_lib/brandVisualAnalyzer.js')

// ── Arg parsing ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const a = args.find((a) => a.startsWith(`--${name}=`))
  return a ? a.split('=').slice(1).join('=') : null
}

const slugFilter = opt('slug')       // run for one workspace
const sampleSize = parseInt(opt('sample') || '20', 10)
const dryRun     = flag('dry-run')
const allMode    = flag('all')

// ── Supabase helpers ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_KEY not set')
  process.exit(1)
}

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

async function fetchWorkspaces() {
  let url = `workspaces?select=id,slug,display_name,video_pipeline_enabled&order=created_at.asc`
  if (slugFilter) url += `&slug=eq.${slugFilter}`
  else if (!allMode) url += `&video_pipeline_enabled=eq.true`  // default: only video-enabled
  const res = await sb(url)
  if (!res.ok) throw new Error(`Failed to fetch workspaces: ${res.status}`)
  return await res.json()
}

async function patchWorkspace(id, data) {
  const res = await sb(`workspaces?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`PATCH failed: ${res.status} ${err}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const workspaces = await fetchWorkspaces()

if (!workspaces.length) {
  console.log(slugFilter
    ? `No workspace found with slug '${slugFilter}'`
    : 'No video-pipeline-enabled workspaces found. Use --all to run on all.')
  process.exit(0)
}

console.log(`\n🎨 Brand Visual Identity Extractor`)
console.log(`   Workspaces: ${workspaces.map((w) => w.slug).join(', ')}`)
console.log(`   Sample size: ${sampleSize} photos per workspace`)
if (dryRun) console.log(`   DRY RUN — no writes`)
console.log()

let succeeded = 0
let failed = 0

for (const ws of workspaces) {
  process.stdout.write(`  ${ws.slug} (${ws.display_name})… `)
  const t0 = Date.now()
  try {
    const identity = await analyzeBrandVisuals({ workspaceId: ws.id, sampleSize })
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

    if (dryRun) {
      console.log(`✓ [dry-run] ${elapsed}s — ${identity.sampleCount} photos`)
      console.log(`      Colors: ${identity.dominantColors?.join(', ')}`)
      console.log(`      Personality: ${identity.brandPersonality?.join(', ')}`)
    } else {
      await patchWorkspace(ws.id, { brand_visual_identity: identity })
      console.log(`✓ ${elapsed}s — ${identity.sampleCount} photos`)
      console.log(`      Colors: ${identity.dominantColors?.join(', ')}`)
      console.log(`      Personality: ${identity.brandPersonality?.join(', ')}`)
    }
    succeeded++
  } catch (e) {
    console.log(`✗ ${e.message}`)
    failed++
  }
}

console.log(`\nDone: ${succeeded} succeeded, ${failed} failed`)
if (dryRun) console.log('(Dry run — nothing was written to the database)')
