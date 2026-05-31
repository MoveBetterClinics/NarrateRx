#!/usr/bin/env node
/**
 * Grader validation — does the rewritten rubric reward FAITHFULNESS over clinical
 * register? (And did the old rubric have the bias?)
 *
 * Methodology: for each REAL clip transcript, two controlled probe captions are
 * scored by both rubrics (mean of N Haiku samples):
 *   • FAITHFUL  — paraphrases what the clinician actually said (warm/personal here,
 *                 because these transcripts ARE personal).
 *   • CLINICAL  — fluent anatomy/technique jargon that the clinician did NOT say
 *                 (unfaithful to the clip).
 *
 * Expected:
 *   NEW rubric → FAITHFUL > CLINICAL   (faithfulness wins; personal not penalized)
 *   OLD rubric → CLINICAL ≥ FAITHFUL   (the clinical-register bias we're fixing)
 *
 * The probe captions are deliberate test inputs for the measurement instrument,
 * not app data. The transcripts are real prod media_assets.transcription.
 *
 * READ-ONLY. Usage:
 *   set -a && source .env.local && set +a && node scripts/grader-faithfulness-validate.mjs
 */

import { readFile } from 'node:fs/promises'
import { generateText } from 'ai'
import { buildFidelityPrompt, parseFidelity, FIDELITY_DIMENSIONS } from '../api/_lib/captionFidelityRubric.js'

const envText = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'AI_GATEWAY_API_KEY']) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) { console.error(`✗ env ${k}`); process.exit(1) }
}
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY
const EVAL_MODEL = 'anthropic/claude-haiku-4-5'
const SAMPLES = 3
const sb = (p) => fetch(`${U}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } }).then((r) => r.json())

// ── OLD rubric (verbatim, for the before/after contrast) ───────────────────────
const OLD_DIMS = ['voice_fidelity', 'clinical_texture', 'redundancy', 'specificity', 'brand_fit']
function buildOldPrompt({ topic, caption, staffName, phrases, workspaceName }) {
  const ex = (phrases || []).slice(0, 8).map((p) => `- "${p.phrase}"`).join('\n')
  const has = ex.length > 0
  return {
    system: `You are a precise content quality evaluator for SHORT social-distribution copy
(captions + thumbnail titles). Score the package on multiple voice fidelity
dimensions. Return ONLY valid JSON — no markdown, no preamble, no commentary.`,
    user: `Evaluate this story package — a thumbnail title + accompanying caption that
will be burned into video subtitles and posted as the social caption. Written
for ${staffName} at ${workspaceName}.

${has ? `CLINICIAN'S AUTHENTIC VOICE PHRASES (use these to judge fidelity):\n${ex}` : `(No voice phrases on record — score voice_fidelity at 5.)`}

TITLE (${(topic || '').length} chars): "${topic || ''}"
CAPTION (${(caption || '').length} chars): "${caption || ''}"

Return EXACTLY this JSON (no other keys):
{
  "voice_fidelity": <1-10; rhythm + word choice match to the voice phrases above${has ? '' : '; 5 if no phrases'}>,
  "clinical_texture": <1-10; sounds like a real practitioner, not generic content-mill>,
  "redundancy": <1-10 INVERSE — 10=tight, 1=title and caption restate each other>,
  "specificity": <1-10; concrete vs vague (real anatomy, technique names, situations, not platitudes)>,
  "brand_fit": <1-10; feels like an authentic practice voice, not a corporate template>,
  "red_flag": "<one short phrase or 'none'>"
}`,
  }
}
function parseOld(text) {
  let r = {}
  try { r = JSON.parse(text.trim()) } catch { try { r = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) } catch { return null } }
  const v = OLD_DIMS.filter((d) => typeof r[d] === 'number')
  return v.length ? { overall: v.reduce((s, d) => s + r[d], 0) / v.length, red_flag: r.red_flag } : null
}

async function avgScore(buildFn, parseFn, args) {
  const runs = []
  for (let i = 0; i < SAMPLES; i++) {
    const p = buildFn(args)
    const { text } = await generateText({ model: EVAL_MODEL, system: p.system, messages: [{ role: 'user', content: p.user }], maxOutputTokens: 240 })
    const parsed = parseFn(text)
    if (parsed?.overall != null) runs.push(parsed)
  }
  if (!runs.length) return { overall: null, red_flag: null }
  return { overall: Number((runs.reduce((s, r) => s + r.overall, 0) / runs.length).toFixed(2)), red_flag: runs[runs.length - 1].red_flag }
}
const newScore = (args) => avgScore(buildFidelityPrompt, (t) => parseFidelity(t), args)
const oldScore = (args) => avgScore(buildOldPrompt, parseOld, args)

// ── Probes (real transcript + two controlled captions) ─────────────────────────
const PEOPLE = '76faa447-b1f4-4038-babc-4d86536b049d'
const Q = 'ecc80e20', CULLEN = '4dc8770f'
const PROBES = [
  {
    assetPfx: 'b2d992a2', grade: Q, label: 'Q — "for their whole life / first time in 20 years"',
    faithful: 'Some of these patients I get to know for their whole life — and when someone does a thing for the first time in 20 years, it stops you in your tracks. Getting to take even a little of someone\'s suffering away is the whole reason I love walking in the door.',
    clinical: 'Restoring optimal kinetic-chain mechanics starts with assessing pelvic tilt, thoracic rotation, and load tolerance before progressing to compound movement patterning. Structure dictates function — correct the pattern and the pain resolves.',
  },
  {
    assetPfx: 'd584f94f', grade: CULLEN, label: 'Cullen — "I was 19 and too nervous to walk into a gym"',
    faithful: 'I still remember being 19 and too nervous to walk into a gym until I felt "fit enough" first — so I get it. My promise is simple: come in, you\'ll feel comfortable, and we\'ll figure out the why behind your pain together.',
    clinical: 'A complete movement screen isolates piriformis tension, hip-flexion deficits, and pelvic asymmetry. We sequence soft-tissue release with corrective loading to normalize the pattern and offload the irritated segment.',
  },
]

const roster = await sb(`staff?workspace_id=eq.${PEOPLE}&select=id,name`)
const idx = await sb(`media_assets?workspace_id=eq.${PEOPLE}&kind=eq.video&select=id&limit=2000`)
async function phrasesFor(prefix) {
  const s = roster.find((r) => r.id.startsWith(prefix))
  const ph = await sb(`staff_voice_phrases?staff_id=eq.${s.id}&workspace_id=eq.${PEOPLE}&select=phrase,weight&order=weight.desc&limit=8`)
  return { name: s.name, phrases: ph }
}

console.log(`Grader validation — NEW vs OLD rubric, mean of ${SAMPLES} samples (${EVAL_MODEL})`)
console.log(`Dimensions (new): ${FIDELITY_DIMENSIONS.join(', ')}\n`)

let newCorrect = 0, oldCorrect = 0
for (const pr of PROBES) {
  const fid = idx.find((r) => r.id.startsWith(pr.assetPfx))?.id
  const a = (await sb(`media_assets?id=eq.${fid}&select=transcription`))[0]
  const transcript = String(a?.transcription || '').trim()
  const { name, phrases } = await phrasesFor(pr.grade)
  const common = { topic: 'Move Better', staffName: name, phrases, workspaceName: 'Move Better People' }

  const nF = await newScore({ ...common, caption: pr.faithful, transcript })
  const nC = await newScore({ ...common, caption: pr.clinical, transcript })
  const oF = await oldScore({ ...common, caption: pr.faithful })   // old rubric never saw the transcript
  const oC = await oldScore({ ...common, caption: pr.clinical })

  const newPicksFaithful = nF.overall > nC.overall
  const oldPicksClinical = oC.overall >= oF.overall
  if (newPicksFaithful) newCorrect++
  if (oldPicksClinical) oldCorrect++

  console.log(`━━━ ${pr.label} (graded vs ${name}) ━━━`)
  console.log(`            FAITHFUL   CLINICAL-UNFAITHFUL   winner`)
  console.log(`  NEW       ${String(nF.overall).padEnd(10)} ${String(nC.overall).padEnd(20)} ${newPicksFaithful ? 'FAITHFUL ✅ (faithfulness rewarded)' : 'clinical ❌'}`)
  console.log(`  OLD       ${String(oF.overall).padEnd(10)} ${String(oC.overall).padEnd(20)} ${oldPicksClinical ? 'CLINICAL ⚠️ (the bias)' : 'faithful'}`)
  console.log('')
}

console.log('════════════════════ RESULT ════════════════════')
console.log(`NEW rubric rewards the faithful (personal) caption:  ${newCorrect}/${PROBES.length}`)
console.log(`OLD rubric rewards the clinical (unfaithful) caption: ${oldCorrect}/${PROBES.length}  ← the bug, reproduced`)
