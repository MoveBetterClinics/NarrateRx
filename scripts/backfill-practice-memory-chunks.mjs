#!/usr/bin/env node
// Backfill practice_memory_chunks for every existing interview summary and
// every approved/published content_item across all workspaces (or a single
// workspace passed via --workspace=<slug>).
//
// Idempotent — upserts on (source_type, source_id, chunk_index), so re-runs
// only re-embed missing or changed rows.
//
// Usage:
//   node scripts/backfill-practice-memory-chunks.mjs [--workspace=<slug>] [--dry-run]
//
// Required env (read from .env.local):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_KEY
//   - OPENAI_API_KEY  (Sensitive — must be present unredacted)

import { readFile } from 'node:fs/promises'

const envText = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const args = process.argv.slice(2)
const workspaceSlug = args.find((a) => a.startsWith('--workspace='))?.split('=')[1]
const DRY_RUN = args.includes('--dry-run')

const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY']
for (const k of need) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`Missing or redacted env: ${k}`)
    process.exit(1)
  }
}

const { indexInterviewSummary, indexContentItem, indexInterviewTranscriptFull } = await import('../api/_lib/practiceMemoryRag.js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
}

const wsFilter = workspaceSlug
  ? `&slug=eq.${encodeURIComponent(workspaceSlug)}`
  : ''
const wsRes = await sb(`workspaces?select=id,slug${wsFilter}`)
if (!wsRes.ok) {
  console.error(`workspaces fetch ${wsRes.status}`)
  process.exit(1)
}
const workspaces = await wsRes.json()
if (workspaces.length === 0) {
  console.error('No workspaces matched.')
  process.exit(1)
}
console.log(`Workspaces to backfill: ${workspaces.map((w) => w.slug).join(', ')}`)

let totals = { interviews: 0, transcripts: 0, contentItems: 0 }
for (const ws of workspaces) {
  console.log(`\n── ${ws.slug} (${ws.id}) ──`)

  const ivRes = await sb(
    `interviews?workspace_id=eq.${ws.id}&summary_text=not.is.null&select=id,clinician_id,topic,summary_text,created_at&order=created_at.desc`
  )
  if (!ivRes.ok) {
    console.error(`  interviews fetch ${ivRes.status}`)
    continue
  }
  const interviews = await ivRes.json()
  console.log(`  interviews with summary: ${interviews.length}`)
  for (const iv of interviews) {
    if (DRY_RUN) {
      totals.interviews += 1
      continue
    }
    await indexInterviewSummary({
      workspaceId:  ws.id,
      clinicianId:  iv.clinician_id,
      interviewId:  iv.id,
      summaryText:  iv.summary_text,
      topic:        iv.topic,
      createdAt:    iv.created_at,
    })
    totals.interviews += 1
    if (totals.interviews % 20 === 0) console.log(`  …${totals.interviews} interviews indexed`)
  }

  // Author Mode substrate: raw interview transcripts (NOT the AI summary).
  // Indexed as source_type='interview_transcript_full'. Includes interviews
  // that never produced a summary (abandoned mid-flow, manual drafts) so
  // long as they have message content.
  const ivFullRes = await sb(
    `interviews?workspace_id=eq.${ws.id}&status=eq.completed&select=id,clinician_id,topic,messages,cleaned_messages,created_at&order=created_at.desc`
  )
  if (!ivFullRes.ok) {
    console.error(`  raw-transcript fetch ${ivFullRes.status}`)
  } else {
    const ivFulls = await ivFullRes.json()
    const ivFullsWithContent = ivFulls.filter((iv) => {
      const cleaned = Array.isArray(iv.cleaned_messages) ? iv.cleaned_messages : []
      const raw = Array.isArray(iv.messages) ? iv.messages : []
      return cleaned.length > 0 || raw.length > 0
    })
    console.log(`  interviews with raw transcript content: ${ivFullsWithContent.length}`)
    for (const iv of ivFullsWithContent) {
      if (DRY_RUN) {
        totals.transcripts += 1
        continue
      }
      await indexInterviewTranscriptFull({
        workspaceId:     ws.id,
        clinicianId:     iv.clinician_id,
        interviewId:     iv.id,
        messages:        iv.messages,
        cleanedMessages: iv.cleaned_messages,
        topic:           iv.topic,
        createdAt:       iv.created_at,
      })
      totals.transcripts += 1
      if (totals.transcripts % 20 === 0) console.log(`  …${totals.transcripts} transcripts indexed`)
    }
  }

  const ciRes = await sb(
    `content_items?workspace_id=eq.${ws.id}&status=in.(approved,published)&archived_at=is.null&select=id&order=created_at.desc`
  )
  if (!ciRes.ok) {
    console.error(`  content_items fetch ${ciRes.status}`)
    continue
  }
  const items = await ciRes.json()
  console.log(`  approved/published content_items: ${items.length}`)
  for (const it of items) {
    if (DRY_RUN) {
      totals.contentItems += 1
      continue
    }
    await indexContentItem({ workspaceId: ws.id, contentItemId: it.id })
    totals.contentItems += 1
    if (totals.contentItems % 20 === 0) console.log(`  …${totals.contentItems} content_items indexed`)
  }
}

console.log(`\nDone. interviews=${totals.interviews} transcripts=${totals.transcripts} content_items=${totals.contentItems}${DRY_RUN ? ' (dry-run)' : ''}`)
