#!/usr/bin/env node
// Backfill content_items.provenance for existing rows that pre-date the
// hybrid model-emit / algorithmic pipeline (migration 043).
//
// Algorithmic only — no model calls. Reads each content_item's `content` plus
// the originating interview's user messages and runs the same similarity
// matcher the server uses as a fallback. Stores with source:
// "algorithmic_backfill" so we can tell the population path apart later.
//
// Usage (from NarrateRx project root):
//   node scripts/backfill-provenance.mjs
//
// Optional flags:
//   --dry-run    Show what would be backfilled without writing
//   --verbose    Log every row touched
//   --limit=N    Cap rows processed (default: all eligible)
//
// Idempotent: skips rows where provenance IS NOT NULL. Safe to re-run.
//
// Requires MULTITENANT_DATABASE_URL in .env.local.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { computeProvenance } from '../api/_lib/provenanceMatcher.js'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

// ─── Config ──────────────────────────────────────────────────────────────────

const DRY_RUN  = process.argv.includes('--dry-run')
const VERBOSE  = process.argv.includes('--verbose')
const LIMIT    = (() => {
  const m = process.argv.find((a) => a.startsWith('--limit='))
  return m ? Number.parseInt(m.split('=')[1], 10) : null
})()

const BATCH_SIZE = 50         // pause + commit checkpoint every N rows
const BATCH_PAUSE_MS = 100    // breath for the DB between batches

// ─── Env ─────────────────────────────────────────────────────────────────────

const env = await readFile('.env.local', 'utf8').catch(() => '')
const m = env.match(/^MULTITENANT_DATABASE_URL=(.+)$/m)
if (!m) {
  console.error('MULTITENANT_DATABASE_URL not found in .env.local')
  console.error('(After `vercel env pull`, restore the unredacted value from 1Password — Sensitive vars come back as *****REDACTED***** and break this script.)')
  process.exit(1)
}
const connectionString = m[1].trim().replace(/^"(.*)"$/, '$1')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function extractUserMessages(rawMessages, cleanedMessages) {
  const src = Array.isArray(cleanedMessages) && cleanedMessages.length
    ? cleanedMessages
    : (Array.isArray(rawMessages) ? rawMessages : [])
  return src
    .filter((row) => row?.role === 'user' && typeof row?.content === 'string')
    .map((row) => row.content)
}

// ─── Main ────────────────────────────────────────────────────────────────────

const client = new Client({ connectionString })
await client.connect()

console.log(`[backfill-provenance] connected · ${DRY_RUN ? 'DRY RUN' : 'WRITE'} · limit=${LIMIT ?? 'all'}`)

// Eligible rows: have content, have an interview, and provenance not yet set.
const limitClause = LIMIT ? `LIMIT ${LIMIT}` : ''
const sql = `
  SELECT ci.id, ci.interview_id, ci.workspace_id, ci.platform, ci.content,
         iv.messages, iv.cleaned_messages
  FROM content_items ci
  LEFT JOIN interviews iv ON iv.id = ci.interview_id
  WHERE ci.provenance IS NULL
    AND ci.content IS NOT NULL
    AND length(trim(ci.content)) > 0
  ORDER BY ci.created_at DESC
  ${limitClause}
`

const { rows } = await client.query(sql)
console.log(`[backfill-provenance] ${rows.length} rows eligible`)

let updated = 0
let skipped = 0
let errors = 0

for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i]
  try {
    const userMessages = extractUserMessages(row.messages, row.cleaned_messages)
    if (userMessages.length === 0) {
      // No transcript to attribute against — still populate with all-synthesis
      // summary so we don't keep retrying this row on subsequent runs.
      if (VERBOSE) console.log(`  · ${row.id} (${row.platform}) — no transcript, marking synthesis`)
    }

    const provenance = computeProvenance(row.content, userMessages, { source: 'algorithmic_backfill' })

    if (DRY_RUN) {
      if (VERBOSE) {
        console.log(`  · ${row.id} (${row.platform}): ${provenance.blocks.length} blocks, ${provenance.summary.verbatim_pct}% verbatim / ${provenance.summary.paraphrase_pct}% paraphrase / ${provenance.summary.synthesis_pct}% synthesis`)
      }
      updated += 1
    } else {
      await client.query(
        'UPDATE content_items SET provenance = $1 WHERE id = $2',
        [provenance, row.id],
      )
      updated += 1
      if (VERBOSE) {
        console.log(`  ✓ ${row.id} (${row.platform}): ${provenance.blocks.length} blocks · v${provenance.summary.verbatim_pct}/p${provenance.summary.paraphrase_pct}/s${provenance.summary.synthesis_pct}`)
      }
    }
  } catch (e) {
    errors += 1
    console.error(`  ✗ ${row.id}: ${e?.message}`)
  }

  if ((i + 1) % BATCH_SIZE === 0) {
    if (!DRY_RUN) await sleep(BATCH_PAUSE_MS)
    console.log(`[backfill-provenance] ${i + 1}/${rows.length} processed (${updated} updated, ${skipped} skipped, ${errors} errors)`)
  }
}

console.log(`[backfill-provenance] done · ${updated} updated · ${skipped} skipped · ${errors} errors`)

await client.end()
process.exit(errors > 0 ? 1 : 0)
