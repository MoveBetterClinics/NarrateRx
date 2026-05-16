#!/usr/bin/env node
// Phase C.1 — Seed clinician_voice_phrases from existing accepted content.
//
// Scans every content_item with status 'approved' or 'published' that has a
// clinician_id, extracts short characteristic sentences from the content body,
// and upserts them into clinician_voice_phrases.
//
// Each time a phrase appears in an accepted item the approve_count is bumped
// by 1. On conflict (same workspace × clinician × normalized phrase) the
// counts and last_seen_at are merged rather than overwritten, so this script
// is safe to re-run — it is fully idempotent.
//
// Usage (from NarrateRx project root):
//   node scripts/backfill-voice-phrases.mjs
//
// Optional flags:
//   --dry-run   Print extracted phrases without writing to DB
//   --verbose   Log every phrase as it is inserted/skipped
//
// Requires MULTITENANT_DATABASE_URL in .env.local.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extractPhrasesFromContent } from '../api/_lib/voicePhraseExtractor.js'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

// ─── Config ──────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose')

const BATCH_SIZE = 100  // rows per INSERT batch

// ─── Env ─────────────────────────────────────────────────────────────────────

const env = await readFile('.env.local', 'utf8').catch(() => '')
const match = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
if (!match) {
  console.error('MULTITENANT_DATABASE_URL not found in .env.local')
  process.exit(1)
}
const connectionString = match[1].trim().replace(/^"(.*)"$/, '$1')

// The extraction algorithm (sentence split + voice-worthy gate + normalize)
// is imported from api/_lib/voicePhraseExtractor.js so this script and the
// runtime approve-hook stay in lockstep — moving a gate in one place is
// guaranteed to update the other.
const extractPhrases = extractPhrasesFromContent

// ─── Main ────────────────────────────────────────────────────────────────────

const client = new Client({ connectionString })
await client.connect()

const host = new URL(connectionString.replace(/^postgresql:\/\//, 'http://')).host
console.log(`Connected to ${host}`)
if (DRY_RUN) console.log('DRY RUN — no writes will be made\n')

// 1. Fetch accepted content items with a clinician
console.log('Fetching accepted content_items...')
const { rows: items } = await client.query(`
  SELECT id, workspace_id, clinician_id, content, status, created_at
  FROM   content_items
  WHERE  status IN ('approved', 'published')
    AND  clinician_id IS NOT NULL
    AND  content IS NOT NULL
    AND  content <> ''
  ORDER  BY created_at ASC
`)
console.log(`Found ${items.length} accepted content_items\n`)

if (items.length === 0) {
  console.log('Nothing to backfill.')
  await client.end()
  process.exit(0)
}

// 2. Extract phrases — accumulate in a map keyed by
//    `${workspace_id}::${clinician_id}::${phrase_normalized}` so we can merge
//    counts when the same phrase appears across multiple items before writing.
const phraseMap = new Map()   // key → { workspace_id, clinician_id, phrase, phrase_normalized, approve_count, last_seen_at }

let itemsWithPhrases = 0
let totalPhraseOccurrences = 0

for (const item of items) {
  const phrases = extractPhrases(item.content)
  if (phrases.length === 0) continue
  itemsWithPhrases++
  totalPhraseOccurrences += phrases.length

  for (const { phrase, phrase_normalized } of phrases) {
    const key = `${item.workspace_id}::${item.clinician_id}::${phrase_normalized}`
    if (phraseMap.has(key)) {
      const existing = phraseMap.get(key)
      existing.approve_count++
      if (item.created_at > existing.last_seen_at) {
        existing.last_seen_at = item.created_at
      }
    } else {
      phraseMap.set(key, {
        workspace_id:     item.workspace_id,
        clinician_id:     item.clinician_id,
        phrase,
        phrase_normalized,
        approve_count:    1,
        reject_count:     0,
        last_seen_at:     item.created_at,
      })
    }
  }
}

const uniquePhrases = [...phraseMap.values()]

console.log(`Extracted ${totalPhraseOccurrences} phrase occurrences from ${itemsWithPhrases} items`)
console.log(`${uniquePhrases.length} unique (workspace × clinician × phrase_normalized) tuples\n`)

if (DRY_RUN) {
  // Group by clinician for readable output
  const byClinician = {}
  for (const p of uniquePhrases) {
    const k = `${p.workspace_id} / ${p.clinician_id}`
    if (!byClinician[k]) byClinician[k] = []
    byClinician[k].push(p)
  }
  for (const [grp, phrases] of Object.entries(byClinician)) {
    console.log(`── ${grp} (${phrases.length} phrases) ──`)
    for (const p of phrases.sort((a, b) => b.approve_count - a.approve_count).slice(0, 20)) {
      console.log(`  [×${p.approve_count}] ${p.phrase}`)
    }
    console.log()
  }
  await client.end()
  process.exit(0)
}

// 3. Batch upsert
//    ON CONFLICT merges approve_count and takes the later last_seen_at.
//    weight stays at the default (1.0) — the Phase C.3 auto-tune worker owns it.

console.log(`Upserting in batches of ${BATCH_SIZE}...`)
let inserted = 0
let updated  = 0

for (let i = 0; i < uniquePhrases.length; i += BATCH_SIZE) {
  const batch = uniquePhrases.slice(i, i + BATCH_SIZE)

  // Build parameterised VALUES list
  const values = []
  const params = []
  let   pIdx   = 1
  for (const p of batch) {
    values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`)
    params.push(
      p.workspace_id,
      p.clinician_id,
      p.phrase,
      p.phrase_normalized,
      p.approve_count,
      p.reject_count,
      p.last_seen_at,
    )
  }

  const sql = `
    INSERT INTO clinician_voice_phrases
      (workspace_id, clinician_id, phrase, phrase_normalized, approve_count, reject_count, last_seen_at)
    VALUES ${values.join(', ')}
    ON CONFLICT (workspace_id, clinician_id, phrase_normalized)
    DO UPDATE SET
      approve_count = clinician_voice_phrases.approve_count + EXCLUDED.approve_count,
      last_seen_at  = GREATEST(clinician_voice_phrases.last_seen_at, EXCLUDED.last_seen_at)
    RETURNING (xmax = 0) AS was_inserted
  `

  const { rows: results } = await client.query(sql, params)
  const batchInserted = results.filter((r) => r.was_inserted).length
  const batchUpdated  = results.length - batchInserted
  inserted += batchInserted
  updated  += batchUpdated

  const pct = Math.round(((i + batch.length) / uniquePhrases.length) * 100)
  process.stdout.write(`\r  ${i + batch.length}/${uniquePhrases.length} (${pct}%)  inserted=${inserted} updated=${updated}`)

  if (VERBOSE) {
    console.log()
    for (let j = 0; j < batch.length; j++) {
      const p   = batch[j]
      const res = results[j]
      const tag = res.was_inserted ? 'INSERT' : 'UPDATE'
      console.log(`  [${tag}] ×${p.approve_count} "${p.phrase.slice(0, 80)}${p.phrase.length > 80 ? '…' : ''}"`)
    }
  }
}

console.log('\n')
console.log('Done.')
console.log(`  Inserted: ${inserted}`)
console.log(`  Updated:  ${updated}`)
console.log(`  Total:    ${inserted + updated}`)

await client.end()
