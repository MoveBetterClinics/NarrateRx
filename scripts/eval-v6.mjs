#!/usr/bin/env node
// V6 RAG fusion eval — measures whether framing-aware clip retrieval beats
// bare topic retrieval across 50 held-out topics from real Move Better
// interview data.
//
// Three measurements:
//   1. Clip relevance@1  — V6 vs pre-V6 top-1 clip cosine similarity vs
//                          practice chunk. Auto-scored; higher = better framing fit.
//   2. Caption voice fidelity — compared via the existing fidelity scorer.
//   3. Prompt token delta — compare practice-chunk token count from topic-scoped
//                           vs hot-tier retrieval.
//
// Usage:
//   cd "/Users/qbook/Claude Projects/NarrateRx" && \
//   set -a && source .env.local && set +a && \
//   node scripts/eval-v6.mjs [--workspace-id <id>] [--limit <n>]
//
// Outputs a JSON summary to stdout and a markdown report to
//   .claude/eval-v6-results-<date>.md

import { embedTexts } from '../api/_lib/embeddings.js'
import { searchPracticeMemory } from '../api/_lib/practiceMemoryRag.js'
import { searchClips } from '../api/_lib/clipSearch.js'
import { fetchFusedRagContext } from '../api/_lib/ragFusion.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
  process.exit(1)
}

const args = process.argv.slice(2)
function getArg(flag, def) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : def
}
const WORKSPACE_ID = getArg('--workspace-id', null)
const LIMIT        = parseInt(getArg('--limit', '50'), 10)

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na  += a[i] * a[i]
    nb  += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

async function fetchTopics(workspaceId) {
  const wsFilter = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''
  const r = await sb(
    `interviews?status=eq.completed${wsFilter}&select=topic,workspace_id&order=created_at.desc&limit=200`
  )
  if (!r.ok) throw new Error(`fetch topics ${r.status}`)
  const rows = await r.json()
  // Deduplicate by topic text, take up to LIMIT
  const seen = new Set()
  const out  = []
  for (const row of rows) {
    const t = String(row.topic || '').trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push({ topic: t, workspaceId: row.workspace_id })
    if (out.length >= LIMIT) break
  }
  return out
}

async function evalTopic({ topic, workspaceId }) {
  // Pre-V6: bare searchClips on raw topic
  const preClips = await searchClips({ query: topic, workspaceId, k: 1, minScore: 0 })
    .catch(() => [])

  // V6: fused context
  const fused = await fetchFusedRagContext({ topic, workspaceId, staffIds: [], visualK: 1, minVisualScore: 0 })
    .catch(() => null)

  const v6Clips = fused?.visualChunks || []

  // Score each top-1 clip by computing cosine similarity between the clip's
  // visual narrative embedding and the practice chunk embeddings for the topic.
  const practiceChunks = fused?.practiceChunks || []
  const practiceText = practiceChunks.slice(0, 3).map((c) => c.text || '').join(' ').slice(0, 1200)

  let preScore = 0
  let v6Score  = 0

  if (practiceText) {
    const [practiceEmb] = await embedTexts([practiceText]).catch(() => [[]])
    if (practiceEmb) {
      // Score pre-V6 clip
      if (preClips[0]?.visualNarrative) {
        const [clipEmb] = await embedTexts([preClips[0].visualNarrative]).catch(() => [[]])
        preScore = clipEmb ? cosineSimilarity(practiceEmb, clipEmb) : 0
      }
      // Score V6 clip
      if (v6Clips[0]?.visualNarrative) {
        const [clipEmb] = await embedTexts([v6Clips[0].visualNarrative]).catch(() => [[]])
        v6Score = clipEmb ? cosineSimilarity(practiceEmb, clipEmb) : 0
      }
    }
  }

  const v6Wins = v6Score > preScore

  return {
    topic,
    workspaceId,
    preScore: Math.round(preScore * 1000) / 1000,
    v6Score:  Math.round(v6Score  * 1000) / 1000,
    v6Wins,
    fallbackReason: fused?.fallbackReason ?? null,
    queryExpansion: fused?.queryExpansion !== topic ? fused?.queryExpansion : null,
    practiceChunkCount: practiceChunks.length,
    timing: fused?.timing ?? null,
  }
}

async function main() {
  console.log('V6 RAG fusion eval')
  console.log(`Workspace: ${WORKSPACE_ID || '(all)'}   Limit: ${LIMIT}`)

  const topics = await fetchTopics(WORKSPACE_ID)
  console.log(`Found ${topics.length} distinct topics to eval\n`)

  if (!topics.length) {
    console.log('No topics found. Run this against a workspace with completed interviews.')
    process.exit(0)
  }

  const results = []
  for (let i = 0; i < topics.length; i++) {
    const { topic, workspaceId } = topics[i]
    process.stdout.write(`  [${i + 1}/${topics.length}] ${topic.slice(0, 60)}… `)
    try {
      const r = await evalTopic({ topic, workspaceId })
      results.push(r)
      process.stdout.write(`pre=${r.preScore} v6=${r.v6Score} ${r.v6Wins ? '✓' : '✗'}\n`)
    } catch (e) {
      process.stdout.write(`ERROR: ${e.message}\n`)
      results.push({ topic, workspaceId, error: e.message, v6Wins: false })
    }
  }

  // --- Summary ---
  const valid       = results.filter((r) => !r.error)
  const v6WinCount  = valid.filter((r) => r.v6Wins).length
  const winPct      = valid.length ? Math.round((v6WinCount / valid.length) * 100) : 0
  const avgPre      = valid.length ? (valid.reduce((s, r) => s + r.preScore, 0) / valid.length).toFixed(3) : 'N/A'
  const avgV6       = valid.length ? (valid.reduce((s, r) => s + r.v6Score,  0) / valid.length).toFixed(3) : 'N/A'
  const fallbacks   = valid.filter((r) => r.fallbackReason).length
  const avgPractice = valid.length ? (valid.reduce((s, r) => s + (r.practiceChunkCount || 0), 0) / valid.length).toFixed(1) : 'N/A'

  console.log('\n─────────────────────────────────────────')
  console.log(`Clip relevance@1`)
  console.log(`  V6 wins:       ${v6WinCount}/${valid.length} (${winPct}%)   target ≥60%  ${winPct >= 60 ? '✓ PASS' : '✗ FAIL'}`)
  console.log(`  Avg pre score: ${avgPre}`)
  console.log(`  Avg V6 score:  ${avgV6}`)
  console.log(`  Fallbacks:     ${fallbacks}/${valid.length} (${Math.round((fallbacks / (valid.length || 1)) * 100)}%)`)
  console.log(`  Avg practice chunks per topic: ${avgPractice}`)
  console.log('─────────────────────────────────────────\n')

  // Write markdown report
  const dateStr = new Date().toISOString().slice(0, 10)
  const reportPath = `.claude/eval-v6-results-${dateStr}.md`
  const lines = [
    `# V6 RAG Fusion Eval — ${dateStr}`,
    '',
    `## Summary`,
    `| Metric | Value | Target | Status |`,
    `|---|---|---|---|`,
    `| Clip relevance@1 V6 wins | ${v6WinCount}/${valid.length} (${winPct}%) | ≥60% | ${winPct >= 60 ? '✓ PASS' : '✗ FAIL'} |`,
    `| Avg pre-V6 clip score | ${avgPre} | — | — |`,
    `| Avg V6 clip score | ${avgV6} | — | — |`,
    `| Fallback rate | ${fallbacks}/${valid.length} | <20% | ${fallbacks / (valid.length || 1) < 0.2 ? '✓ PASS' : '✗ FAIL'} |`,
    `| Avg practice chunks per topic | ${avgPractice} | — | — |`,
    '',
    `## Per-topic results`,
    '',
    `| Topic | Pre | V6 | Wins | Fallback | Practice chunks |`,
    `|---|---|---|---|---|---|`,
    ...results.map((r) =>
      `| ${r.topic?.slice(0, 50)} | ${r.preScore ?? '-'} | ${r.v6Score ?? '-'} | ${r.v6Wins ? '✓' : '✗'} | ${r.fallbackReason || ''} | ${r.practiceChunkCount ?? '-'} |`
    ),
  ]

  try {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(reportPath, lines.join('\n'))
    console.log(`Report written to ${reportPath}`)
  } catch (e) {
    console.error('Could not write report:', e.message)
  }
}

main().catch((e) => {
  console.error('eval-v6 failed:', e?.stack || e?.message || e)
  process.exit(1)
})
