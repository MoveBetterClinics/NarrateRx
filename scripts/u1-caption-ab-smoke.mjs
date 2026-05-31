#!/usr/bin/env node
/**
 * U1 keystone — Caption A→C smoke (transcript-grounding lift)
 *
 * Reproduces the roadmap's A→C smoke proof against REAL clips on prod. For each
 * clip it generates the caption two ways through the SAME generateCaption() the
 * pipeline uses, varying exactly one input:
 *
 *   A — today's path:  clipTranscript = ''   (transcript bypassed)
 *   C — U1 path:       clipTranscript = <the clip's own real transcript>
 *
 * Topic, staffId, clip context, and the voice-phrase corpus are held constant,
 * so any score delta is attributable solely to the transcript grounding U1 adds.
 * Each caption is then scored with the same Haiku evaluator + prompt as
 * scripts/voice-fidelity-captions.mjs (the CI-gate scorer), against the
 * clinician's real staff_voice_phrases.
 *
 * READ-ONLY: pulls workspace/staff/phrases/asset rows; never writes. No
 * story_packages are touched, no scores persisted.
 *
 * Usage:
 *   cd "<project root or worktree>" && set -a && source .env.local && set +a \
 *     && node scripts/u1-caption-ab-smoke.mjs
 *
 * Required env (from .env.local): SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY
 */

import { readFile } from 'node:fs/promises'
import { generateText } from 'ai'
import { generateCaption } from '../api/_lib/captionGen.js'

// ── env ───────────────────────────────────────────────────────────────────────
const envText = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'AI_GATEWAY_API_KEY']) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`✗ Missing or redacted env: ${k}`); process.exit(1)
  }
}
const U = process.env.SUPABASE_URL
const K = process.env.SUPABASE_SERVICE_KEY
const EVAL_MODEL = 'anthropic/claude-haiku-4-5'
const sb = (p) => fetch(`${U}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } }).then((r) => r.json())

// ── Clips under test (real prod media_assets, verified 2026-05-30) ─────────────
// scoreStaffId = the clinician whose phrase corpus the caption is graded against.
// Most Move Better media has staff_id = null (the F4 backfill is out of U1's
// scope), so — exactly as the roadmap A→C smoke did — Q-authored clips are graded
// against Q's 146 phrases; the Cullen clip is a fully-real triple graded against
// Cullen's own 53 phrases.
const Q_STAFF = 'ecc80e20'        // resolved to full id below; Dr. Q, 146 phrases
const CULLEN_STAFF = '4dc8770f'   // Dr. Zachary Cullen, 53 phrases
const PEOPLE_WS = '76faa447-b1f4-4038-babc-4d86536b049d'
// authorMatch=true → the transcript's speaker IS the clinician we grade against
// (the production-representative case: render-segments always grades a clip
// against its own clinician). authorMatch=false clips grade a non-Q transcript
// against Q's corpus — included only to mirror the roadmap smoke; their negative
// deltas are a grading artifact, not a production behavior.
const CLIPS = [
  { assetId: 'b2d992a2', grade: Q_STAFF,      authorMatch: true,  label: 'Q - Move Better.mov (Q→Q)' },
  { assetId: 'd584f94f', grade: CULLEN_STAFF, authorMatch: true,  label: 'Zach - Move Better.mov (Cullen→Cullen, real triple)' },
  { assetId: '55197c20', grade: CULLEN_STAFF, authorMatch: true,  label: 'Zach Push.mov (Cullen→Cullen)' },
  { assetId: '1dbd6377', grade: Q_STAFF,      authorMatch: false, label: 'Move Better v2.mov (multi-clinician montage→Q)' },
  { assetId: '1eb9ffb5', grade: Q_STAFF,      authorMatch: false, label: 'Alli - Move Better.mov (Alli→Q)' },
  { assetId: 'b3d1b2bc', grade: Q_STAFF,      authorMatch: false, label: 'Hope TG.mov (→Q)' },
  { assetId: '930a38af', grade: Q_STAFF,      authorMatch: false, label: 'Hope Turkish Get-up (→Q)' },
  { assetId: 'e5473db3', grade: Q_STAFF,      authorMatch: false, label: 'P1109360.MP4 (→Q)' },
]

// ── Evaluator (identical prompt to scripts/voice-fidelity-captions.mjs) ─────────
function buildEvalPrompt({ topic, caption, staffName, phrases, workspaceName }) {
  const phraseExamples = (phrases || []).slice(0, 8).map((p) => `- "${p.phrase}"`).join('\n')
  const hasPhrases = phraseExamples.length > 0
  return {
    system: `You are a precise content quality evaluator for SHORT social-distribution copy
(captions + thumbnail titles). Score the package on multiple voice fidelity
dimensions. Return ONLY valid JSON — no markdown, no preamble, no commentary.`,
    user: `Evaluate this story package — a thumbnail title + accompanying caption that
will be burned into video subtitles and posted as the social caption. Written
for ${staffName} at ${workspaceName}.

${hasPhrases ? `CLINICIAN'S AUTHENTIC VOICE PHRASES (use these to judge fidelity):
${phraseExamples}` : `(No voice phrases on record for this clinician yet — score voice_fidelity at 5 if you can't compare.)`}

TITLE (thumbnail text, ${(topic || '').length} chars):
"${topic || ''}"

CAPTION (subtitle + social copy, ${(caption || '').length} chars):
"${caption || ''}"

Score each dimension 1–10 and return this exact JSON shape (no other keys):
{
  "voice_fidelity": <1-10; rhythm + word choice match to the voice phrases above${hasPhrases ? '' : '; score 5 if no phrases'}>,
  "clinical_texture": <1-10; sounds like a real practitioner, not generic content-mill>,
  "redundancy": <1-10 INVERSE — 10=tight no repetition, 1=title and caption restate each other>,
  "specificity": <1-10; concrete vs vague (real anatomy, technique names, situations, not platitudes)>,
  "brand_fit": <1-10; feels like an authentic practice voice, not a corporate template>,
  "red_flag": "<one short phrase: the single biggest issue, or 'none'>"
}`,
  }
}
const DIMS = ['voice_fidelity', 'clinical_texture', 'redundancy', 'specificity', 'brand_fit']
const EVAL_SAMPLES = 3   // single-shot Haiku scoring is noisy (±2); average to stabilize.
async function scoreOnce({ topic, caption, staffName, phrases, workspaceName }) {
  const p = buildEvalPrompt({ topic, caption, staffName, phrases, workspaceName })
  const { text } = await generateText({ model: EVAL_MODEL, system: p.system, messages: [{ role: 'user', content: p.user }], maxOutputTokens: 220 })
  let r = {}
  try { r = JSON.parse(text.trim()) } catch { try { r = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) } catch { /* empty */ } }
  const valid = DIMS.filter((d) => typeof r[d] === 'number')
  const overall = valid.length ? valid.reduce((s, d) => s + r[d], 0) / valid.length : null
  return { overall, voice_fidelity: typeof r.voice_fidelity === 'number' ? r.voice_fidelity : null, red_flag: r.red_flag || null }
}
async function score(args) {
  const runs = []
  for (let i = 0; i < EVAL_SAMPLES; i++) runs.push(await scoreOnce(args))
  const ov = runs.map((r) => r.overall).filter((v) => v != null)
  const vf = runs.map((r) => r.voice_fidelity).filter((v) => v != null)
  const avg = (a) => a.length ? Number((a.reduce((s, x) => s + x, 0) / a.length).toFixed(2)) : null
  return { overall: avg(ov), voice_fidelity: avg(vf), red_flag: runs[runs.length - 1].red_flag, n: ov.length }
}

// ── Load shared context ─────────────────────────────────────────────────────────
const ws = (await sb(`workspaces?id=eq.${PEOPLE_WS}&select=id,slug,display_name,brand_voice`))[0]
const wsName = ws?.display_name || 'workspace'
console.log(`Workspace: ${ws?.slug}  |  eval model: ${EVAL_MODEL}  |  caption model: anthropic/claude-sonnet-4-6\n`)

// Resolve short staff-id prefixes → full ids + names + phrases (graded corpus).
// uuid columns don't support `like`, so fetch the roster and prefix-match in JS.
const roster = await sb(`staff?workspace_id=eq.${PEOPLE_WS}&select=id,name`)
async function resolveStaff(prefix) {
  const s = roster.find((r) => r.id.startsWith(prefix))
  if (!s) throw new Error(`staff prefix ${prefix} not found in People roster`)
  const phrases = await sb(`staff_voice_phrases?staff_id=eq.${s.id}&workspace_id=eq.${PEOPLE_WS}&select=phrase,weight&order=weight.desc&limit=8`)
  return { id: s.id, name: s.name, phrases }
}
const staffCache = {}
for (const pfx of [...new Set(CLIPS.map((c) => c.grade))]) staffCache[pfx] = await resolveStaff(pfx)

// Resolve clip asset-id prefixes → full ids (uuid; prefix-match in JS).
const assetIndex = await sb(`media_assets?workspace_id=eq.${PEOPLE_WS}&kind=eq.video&select=id&limit=2000`)

function cleanFilename(f) { return String(f || '').replace(/\.\w+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() }

// ── Run A vs C per clip ──────────────────────────────────────────────────────────
const results = []
for (const c of CLIPS) {
  const fullId = assetIndex.find((r) => r.id.startsWith(c.assetId))?.id
  const a = fullId ? (await sb(`media_assets?id=eq.${fullId}&workspace_id=eq.${PEOPLE_WS}&select=id,filename,visual_narrative,transcription`))[0] : null
  if (!a) { console.log(`SKIP ${c.label} — asset not found`); continue }
  const staff = staffCache[c.grade]
  const topic = (a.visual_narrative || '').trim() || cleanFilename(a.filename) || 'Movement clip'
  const clip = { visualNarrative: a.visual_narrative || '' }
  const transcript = String(a.transcription || '').trim()

  // Identical inputs except clipTranscript — isolates U1's variable.
  const capA = await generateCaption({ topic, clip, workspace: ws, staffId: staff.id, clipTranscript: '' })
  const capC = await generateCaption({ topic, clip, workspace: ws, staffId: staff.id, clipTranscript: transcript })
  const sA = await score({ topic, caption: capA, staffName: staff.name, phrases: staff.phrases, workspaceName: wsName })
  const sC = await score({ topic, caption: capC, staffName: staff.name, phrases: staff.phrases, workspaceName: wsName })

  results.push({ label: c.label, staff: staff.name, authorMatch: c.authorMatch, topic, transcriptLen: transcript.length, capA, capC, sA, sC })
  console.log(`━━━ ${c.label}  (graded vs ${staff.name}, ${staff.phrases.length} phrases, transcript ${transcript.length} chars) ━━━`)
  console.log(`  topic: ${topic.slice(0, 90)}`)
  console.log(`  A (no transcript)  ${sA.overall}/10  vf=${sA.voice_fidelity}  flag=${sA.red_flag}`)
  console.log(`     "${capA}"`)
  console.log(`  C (+ transcript)   ${sC.overall}/10  vf=${sC.voice_fidelity}  flag=${sC.red_flag}`)
  console.log(`     "${capC}"`)
  console.log(`  Δ overall: ${(sC.overall - sA.overall >= 0 ? '+' : '')}${(sC.overall - sA.overall).toFixed(2)}\n`)
}

// ── Summary ──────────────────────────────────────────────────────────────────────
function summarize(label, rows) {
  const valid = rows.filter((r) => r.sA.overall != null && r.sC.overall != null)
  if (!valid.length) { console.log(`${label}: no valid rows`); return }
  const avgA = valid.reduce((s, r) => s + r.sA.overall, 0) / valid.length
  const avgC = valid.reduce((s, r) => s + r.sC.overall, 0) / valid.length
  const wins = valid.filter((r) => r.sC.overall > r.sA.overall).length
  const ties = valid.filter((r) => r.sC.overall === r.sA.overall).length
  console.log(`\n── ${label} (n=${valid.length}) ──`)
  console.log(`  Avg A (no transcript): ${avgA.toFixed(2)}/10`)
  console.log(`  Avg C (+ transcript):  ${avgC.toFixed(2)}/10`)
  console.log(`  Δ avg:                 ${(avgC - avgA >= 0 ? '+' : '')}${(avgC - avgA).toFixed(2)}`)
  console.log(`  C wins / ties / losses: ${wins} / ${ties} / ${valid.length - wins - ties}`)
}
console.log('\n════════════════════ SUMMARY ════════════════════')
console.log(`(eval = mean of ${EVAL_SAMPLES} Haiku samples per caption)`)
summarize('ALL clips', results)
summarize('Attribution-correct subset (production-representative: transcript author == graded clinician)', results.filter((r) => r.authorMatch))
summarize('Mis-attributed subset (non-Q transcript graded vs Q — grading artifact, not a prod path)', results.filter((r) => !r.authorMatch))
