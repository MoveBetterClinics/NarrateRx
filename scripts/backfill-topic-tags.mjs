#!/usr/bin/env node
// Backfill topic_tags on existing practice_memory_chunks rows.
//
// V6 migration 095 added the topic_tags jsonb column (default []). This script
// runs Haiku over every row where topic_tags IS NULL or topic_tags = '[]' and
// writes 2-4 extracted topic tags back. Idempotent — skips rows that already
// have tags.
//
// Usage (from project root):
//   cd "/Users/qbook/Claude Projects/NarrateRx" && \
//   set -a && source .env.local && set +a && \
//   node scripts/backfill-topic-tags.mjs [--dry-run]
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, and OPENAI_API_KEY in env.

import { generateText } from 'ai'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY
const DRY_RUN        = process.argv.includes('--dry-run')
const BATCH_SIZE     = 50
const CONCURRENCY    = 8  // parallel Haiku calls per batch

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
  process.exit(1)
}

if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
  console.error('ANTHROPIC_API_KEY, OPENAI_API_KEY, or AI_GATEWAY_API_KEY is required for Haiku calls')
  process.exit(1)
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

async function extractTopicTags(text) {
  try {
    const preview = String(text || '').slice(0, 400).trim()
    if (!preview) return []
    const { text: raw } = await generateText({
      model: 'anthropic/claude-haiku-4-5',
      system: 'You extract topic tags from clinical content. Output only a JSON array of 2-4 lowercase strings. No prose, no markdown, just the array.',
      messages: [{
        role: 'user',
        content: `Extract 2-4 topic tags for this clinical content chunk as a JSON array of lowercase strings.\n\nChunk: ${preview}`,
      }],
      maxOutputTokens: 60,
    })
    const match = raw.match(/\[[\s\S]*?\]/)
    if (!match) return []
    const tags = JSON.parse(match[0])
    if (!Array.isArray(tags)) return []
    return tags.filter((t) => typeof t === 'string').slice(0, 4)
  } catch {
    return []
  }
}

async function fetchUntaggedBatch(offset) {
  const r = await sb(
    `practice_memory_chunks?or=(topic_tags.is.null,topic_tags.eq.[])` +
    `&select=id,text` +
    `&order=id.asc` +
    `&limit=${BATCH_SIZE}&offset=${offset}`
  )
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`fetch failed ${r.status}: ${body.slice(0, 200)}`)
  }
  return r.json()
}

async function patchTags(id, topicTags) {
  if (DRY_RUN) return
  const r = await sb(`practice_memory_chunks?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ topic_tags: topicTags }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`  patch failed for ${id} ${r.status}: ${body.slice(0, 100)}`)
  }
}

async function processBatch(rows) {
  // Run CONCURRENCY Haiku calls at a time
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY)
    await Promise.all(slice.map(async (row) => {
      const tags = await extractTopicTags(row.text)
      await patchTags(row.id, tags)
      if (DRY_RUN) {
        console.log(`  [dry-run] ${row.id} → ${JSON.stringify(tags)}`)
      }
    }))
  }
}

async function main() {
  console.log(`Backfilling topic_tags on practice_memory_chunks${DRY_RUN ? ' (DRY RUN)' : ''}…`)
  let total = 0

  // Always fetch from offset=0 — patched rows leave the untagged set so
  // each iteration shrinks it rather than advancing a cursor.
  while (true) {
    const rows = await fetchUntaggedBatch(0)
    if (!rows.length) break

    console.log(`  Processing ${rows.length} untagged chunk${rows.length !== 1 ? 's' : ''}…`)
    await processBatch(rows)
    total += rows.length

    if (rows.length < BATCH_SIZE) break
  }

  console.log(`Done. Tagged ${total} chunk${total !== 1 ? 's' : ''}.`)
}

main().catch((e) => {
  console.error('backfill-topic-tags failed:', e.message)
  process.exit(1)
})
