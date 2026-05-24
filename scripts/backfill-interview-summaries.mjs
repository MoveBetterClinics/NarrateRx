#!/usr/bin/env node
// Phase 5 Feature 2 (PR 2) — backfill summary_text on completed interviews.
//
// Pulls every interview where status='completed' AND summary_text IS NULL,
// then calls api/_lib/interviewSummarizer.js → summarizeInterview() for each.
// Idempotent — already-summarized rows are skipped by the WHERE clause, so
// safe to re-run after a failed batch.
//
// Usage (from NarrateRx project root):
//   node scripts/backfill-interview-summaries.mjs
//
// Optional flags:
//   --dry-run   List candidate rows without calling the summarizer
//   --limit=N   Process at most N rows (default: 50 — safety cap)
//   --workspace=<slug>   Restrict to one workspace (default: all)
//
// Requires .env.local with:
//   - SUPABASE_URL                    (Sensitive)
//   - SUPABASE_SERVICE_KEY            (Sensitive)
//   - AI_GATEWAY_API_KEY              (Sensitive) — Vercel AI Gateway
//
// Cost ballpark: Sonnet 4.6 at ~$3/M input + $15/M output. A typical
// interview transcript truncated to 4000 words ≈ 6k input tokens; output
// ≤ 512 tokens. Per-row cost ≈ $0.025–0.030. 50-row default cap = ~$1.25.

import { readFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '--limit=50').split('=')[1]) || 50
const WORKSPACE_SLUG = (args.find((a) => a.startsWith('--workspace=')) || '').split('=')[1] || null

// ─── Load .env.local into process.env ────────────────────────────────────────

const env = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.+)$/)
  if (!m) continue
  const [, k, raw] = m
  if (!process.env[k]) process.env[k] = raw.trim().replace(/^"(.*)"$/, '$1')
}

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'AI_GATEWAY_API_KEY']
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing required env: ${k}`)
    process.exit(1)
  }
}

// ─── Import summarizer AFTER env is loaded ───────────────────────────────────

const { summarizeInterview } = await import('../api/_lib/interviewSummarizer.js')

// ─── Supabase REST helper ────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

// ─── Fetch candidates ────────────────────────────────────────────────────────

let qs = `interviews?status=eq.completed&summary_text=is.null&select=id,workspace_id,topic,clinician_id,cleaned_messages,messages,clinicians(name),workspaces!inner(slug)&order=created_at.desc&limit=${LIMIT}`
if (WORKSPACE_SLUG) qs += `&workspaces.slug=eq.${WORKSPACE_SLUG}`

const r = await sb(qs)
if (!r.ok) {
  console.error(`Candidate fetch failed: ${r.status} ${await r.text()}`)
  process.exit(1)
}
const rows = await r.json()

console.log(`Found ${rows.length} candidate interview(s) (limit=${LIMIT}${WORKSPACE_SLUG ? `, workspace=${WORKSPACE_SLUG}` : ''})`)
if (DRY_RUN) {
  for (const iv of rows) {
    const turns = (iv.cleaned_messages?.length ? iv.cleaned_messages : iv.messages || [])
      .filter((m) => m?.role === 'user').length
    console.log(`  ${iv.id}  ws=${iv.workspaces?.slug}  topic="${iv.topic}"  turns=${turns}`)
  }
  console.log('(dry-run — no summaries generated)')
  process.exit(0)
}

// ─── Process sequentially to keep cost predictable and rate-limit gentle ─────

let ok = 0, skipped = 0, failed = 0
for (const iv of rows) {
  const messages = iv.cleaned_messages?.length ? iv.cleaned_messages : iv.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    console.log(`  skip ${iv.id} — no messages`)
    skipped += 1
    continue
  }
  try {
    await summarizeInterview({
      interviewId:    iv.id,
      workspaceId:    iv.workspace_id,
      clinicianName:  iv.clinicians?.name || '',
      topic:          iv.topic,
      messages,
    })
    ok += 1
  } catch (e) {
    console.error(`  FAIL ${iv.id}: ${e?.message}`)
    failed += 1
  }
}

console.log(`Done. summarized=${ok} skipped=${skipped} failed=${failed}`)
