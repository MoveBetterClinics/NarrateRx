#!/usr/bin/env node
/**
 * One-off retry for cleanup-transcript on the 4 interviews that previously
 * silently failed (maxTokens: 4000 was too tight for 19–25-message
 * transcripts; the cleaned JSON array was truncated and rejected by the
 * length-match guard). PR #639 raised the prod handler's limits — this
 * script just replays the same logic locally for the already-completed
 * interviews so we don't have to wait for the editor to be re-opened on
 * each one.
 *
 * Lifts the cleanup prompt + validation guards from
 * api/interviews/cleanup-transcript.js verbatim. Writes directly to the
 * Supabase REST API as service_role (same surface the handler uses).
 *
 * Usage from this worktree:
 *   set -a && source /Users/qbook/Claude\ Projects/NarrateRx/.env.local && set +a && \
 *   node scripts/rerun-cleanup-on-failed-interviews.mjs --dry-run
 *   node scripts/rerun-cleanup-on-failed-interviews.mjs --apply
 *
 * Requires MULTITENANT_DATABASE_URL + VERCEL_OIDC_TOKEN (for AI Gateway).
 */

import pg from 'pg'
import { generateText } from 'ai'

const APPLY = process.argv.includes('--apply')
const DRY = !APPLY

const dbUrl = process.env.MULTITENANT_DATABASE_URL
if (!dbUrl) { console.error('MULTITENANT_DATABASE_URL not set'); process.exit(1) }

// pg parser that handles passwords with @
const s = dbUrl.replace(/^postgres(ql)?:\/\//, '')
const la = s.lastIndexOf('@')
const auth = s.slice(0, la); const hp = s.slice(la + 1)
const cIdx = auth.indexOf(':')
const usr = auth.slice(0, cIdx); const pw = auth.slice(cIdx + 1)
const [hostport, dbq = 'postgres'] = hp.split('/')
const [h, port = '5432'] = hostport.split(':')
const { Client } = pg
const c = new Client({
  host: h, port: +port, user: usr, password: pw,
  database: (dbq || 'postgres').split('?')[0],
  ssl: { rejectUnauthorized: false },
})
await c.connect()

// Replicate the exact prompt + guard logic from cleanup-transcript.js
function buildPrompt(messages, terms, fillers, level = 'balanced') {
  const numbered = messages
    .map((m, i) => `[${i}] (${m.role}) ${m.content || ''}`)
    .join('\n\n')

  const doListByLevel = {
    verbatim: [
      `Fix obvious mis-transcriptions of medical / movement-therapy terms, preferring these spellings when context clearly matches: ${terms.join(', ')}.`,
      'Capitalize sentence starts and proper nouns where appropriate.',
      'Stay close to the speaker\'s exact words — keep filler words, false starts, and pauses intact.',
    ],
    balanced: [
      `Remove filler words used as filler (not as substantive vocabulary): ${fillers.join(', ')}.`,
      `Fix obvious mis-transcriptions of medical / movement-therapy terms, preferring these spellings when context clearly matches: ${terms.join(', ')}.`,
      'Lightly re-flow run-ons (add a period or comma where the speaker clearly paused but the recognizer didn\'t capture it). Capitalize where appropriate.',
    ],
    polished: [
      `Remove filler words used as filler (not as substantive vocabulary): ${fillers.join(', ')}.`,
      `Fix obvious mis-transcriptions of medical / movement-therapy terms, preferring these spellings when context clearly matches: ${terms.join(', ')}.`,
      'Re-flow run-ons and merge clearly fragmented sentences within a single turn so the prose reads cleanly. Tighten rambling while keeping every fact the speaker provided.',
      'Capitalize and punctuate as needed.',
    ],
  }
  const doList = (doListByLevel[level] || doListByLevel.balanced).map((line) => `- ${line}`).join('\n')

  return `You are cleaning up a raw interview transcript captured by the Web Speech API. Your job is mechanical, not editorial.

Cleanup level: ${level}

DO:
${doList}

DO NOT:
- Paraphrase, summarize, or compress meaning.
- Drop, merge, or add messages — the output array MUST have the same number of entries in the same order, with the same role on each entry.
- Change meaning, add interpretation, or invent details that weren't said. If you are unsure whether a word is filler or substantive, keep it.
- Translate or modernize vocabulary.

Transcript (numbered, with role tags):
"""
${numbered}
"""

Return ONLY a JSON array of objects, one per input message, in the same order:
[
  { "role": "user" | "assistant", "content": "<cleaned content>" },
  ...
]
The array length and roles must exactly match the input.`
}

function parseCleaned(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return null
    return arr
  } catch { return null }
}

// Pull every completed interview missing cleaned_messages
const { rows } = await c.query(`
  SELECT i.id, i.topic, i.workspace_id, i.messages, i.cleanup_level,
         w.transcript_glossary,
         jsonb_array_length(i.messages) as msg_count
    FROM interviews i
    JOIN workspaces w ON w.id = i.workspace_id
   WHERE i.status = 'completed'
     AND i.cleaned_messages IS NULL
     AND jsonb_array_length(coalesce(i.messages, '[]'::jsonb)) > 0
   ORDER BY i.created_at
`)
console.log(`\n${rows.length} completed interview(s) missing cleaned_messages:`)
for (const r of rows) console.log(`  ${r.id.slice(0, 8)}  ${r.topic.padEnd(50)}  ${r.msg_count} msgs`)

if (DRY) {
  console.log('\n[DRY-RUN — re-run with --apply to clean them]')
  await c.end()
  process.exit(0)
}

// Same glossary defaults as src/lib/medicalGlossary.js (lifted here to avoid
// adding a dependency to the script). If the workspace has a custom glossary,
// it overrides; otherwise fall back to a small built-in.
const DEFAULT_TERMS   = ['lumbar', 'thoracic', 'cervical', 'sciatica', 'piriformis', 'glute', 'L4/L5', 'L5/S1']
const DEFAULT_FILLERS = ['um', 'uh', 'like', 'you know', 'I mean', 'sort of', 'kind of', 'right']
function resolveGlossary(g) {
  if (!g || typeof g !== 'object') return { terms: DEFAULT_TERMS, fillers: DEFAULT_FILLERS }
  return {
    terms:   Array.isArray(g.terms)   && g.terms.length   ? g.terms   : DEFAULT_TERMS,
    fillers: Array.isArray(g.fillers) && g.fillers.length ? g.fillers : DEFAULT_FILLERS,
  }
}

let ok = 0, failed = 0
for (let i = 0; i < rows.length; i++) {
  const r = rows[i]
  const tag = `[${i + 1}/${rows.length}] ${r.topic.slice(0, 40)} (${r.msg_count} msgs)`
  try {
    const { terms, fillers } = resolveGlossary(r.transcript_glossary)
    const prompt = buildPrompt(r.messages, terms, fillers, r.cleanup_level || 'balanced')
    const result = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: prompt,
      messages: [{ role: 'user', content: 'Clean the transcript now.' }],
      maxTokens: 16000,
    })
    const parsed = parseCleaned(result.text || '')
    if (!parsed) throw new Error('unparseable model output')
    if (parsed.length !== r.messages.length) throw new Error(`length mismatch: got ${parsed.length}, expected ${r.messages.length}`)
    for (let j = 0; j < r.messages.length; j++) {
      if (parsed[j]?.role !== r.messages[j].role) throw new Error(`role mismatch at ${j}`)
    }
    const cleaned = parsed.map((m, j) => ({ role: r.messages[j].role, content: String(m.content || '').trim() }))

    // Direct pg UPDATE — the .env.local pull only has MULTITENANT_DATABASE_URL
    // (Sensitive Supabase keys aren't pulled by `vercel env pull`), and the
    // postgres connection is faster anyway since this is a one-off batch.
    await c.query(
      `UPDATE interviews SET cleaned_messages = $1::jsonb, updated_at = now()
         WHERE id = $2 AND workspace_id = $3`,
      [JSON.stringify(cleaned), r.id, r.workspace_id],
    )
    ok++
    console.log(`${tag} → cleaned + saved`)
  } catch (err) {
    failed++
    console.error(`${tag} FAILED: ${err.message}`)
  }
}

console.log(`\n${ok} succeeded, ${failed} failed.`)
await c.end()
process.exit(failed > 0 ? 1 : 0)
