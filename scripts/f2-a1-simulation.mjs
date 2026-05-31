// VERDICT (2026-05-31): the F2 register-balanced voice reference is DO-NOT-BUILD.
// This simulation measured ~0 lift — a faithful emotional caption already scores
// 8/8 voice_match against today's clinical-only reference, because the #1081
// faithfulness-v2 grader already grades against the transcript (gold) with a
// register-neutral voice_match, so re-balancing the low-influence phrase corpus
// moves nothing. Kept ONLY as a cheap regression guard for if the caption-fidelity
// rubric is ever re-tuned. Full write-up: memory project_f2_voiceref_measured_no_build.md.
//
// f2-a1-simulation.mjs — READ-ONLY. Does the A1 balanced sample (clinical phrases
// + simulated interview-backfill phrases) lift a FAITHFUL EMOTIONAL caption's
// voice_match vs today's clinical-only top-8 sample — WITHOUT helping an
// unfaithful caption? Simulates the backfill IN MEMORY (weight-0.5 interview
// phrases extracted live with F1's exact extractor). Writes NOTHING.
//
// Real emotional transcripts + controlled probe captions reused verbatim from
// scripts/grader-faithfulness-validate.mjs (the #1081 harness).
//
//   node scripts/f2-a1-simulation.mjs

import { readFile } from 'node:fs/promises'
import { buildFidelityPrompt, parseFidelity } from '../api/_lib/captionFidelityRubric.js'
import { extractPhrasesFromContent } from '../api/_lib/voicePhraseExtractor.js'
import { generateText } from 'ai'

const envText = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY
const EVAL_MODEL = 'anthropic/claude-haiku-4-5'
const SAMPLES = 3
const sb = (p) => fetch(`${U}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } }).then((r) => r.json())

const PEOPLE = '76faa447-b1f4-4038-babc-4d86536b049d'
// Real emotional/personal transcripts + controlled captions (verbatim from #1081 harness).
const PROBES = [
  {
    assetPfx: 'b2d992a2', staffPfx: 'ecc80e20', label: 'Q — "whole life / first time in 20 years" (emotional)',
    faithful: 'Some of these patients I get to know for their whole life — and when someone does a thing for the first time in 20 years, it stops you in your tracks. Getting to take even a little of someone\'s suffering away is the whole reason I love walking in the door.',
    unfaithful: 'Restoring optimal kinetic-chain mechanics starts with assessing pelvic tilt, thoracic rotation, and load tolerance before progressing to compound movement patterning. Structure dictates function — correct the pattern and the pain resolves.',
  },
  {
    assetPfx: 'd584f94f', staffPfx: '4dc8770f', label: 'Cullen — "19 and too nervous to walk into a gym" (personal)',
    faithful: 'I still remember being 19 and too nervous to walk into a gym until I felt "fit enough" first — so I get it. My promise is simple: come in, you\'ll feel comfortable, and we\'ll figure out the why behind your pain together.',
    unfaithful: 'A complete movement screen isolates piriformis tension, hip-flexion deficits, and pelvic asymmetry. We sequence soft-tissue release with corrective loading to normalize the pattern and offload the irritated segment.',
  },
]

// A1 balanced sampler: up to `half` established (weight>=1.0) + up to `half` provisional (<1.0).
function balancedSample(established, provisional, n = 8) {
  const half = Math.floor(n / 2)
  const out = [...established.slice(0, half), ...provisional.slice(0, half)]
  // backfill from whichever has more if short of n
  for (const p of [...established.slice(half), ...provisional.slice(half)]) {
    if (out.length >= n) break
    out.push(p)
  }
  return out.slice(0, n).map((x) => ({ phrase: x.phrase }))
}

async function meanScore({ transcript, caption, phrases, staffName }) {
  const runs = []
  for (let i = 0; i < SAMPLES; i++) {
    const p = buildFidelityPrompt({ topic: 'Move Better', caption, transcript, phrases, staffName, workspaceName: 'Move Better People' })
    const { text } = await generateText({ model: EVAL_MODEL, system: p.system, messages: [{ role: 'user', content: p.user }], maxOutputTokens: 240 })
    const parsed = parseFidelity(text)
    if (parsed) runs.push(parsed)
  }
  if (!runs.length) return { overall: null, voice: null }
  const avg = (sel) => Number((runs.reduce((s, r) => s + sel(r), 0) / runs.length).toFixed(2))
  return { overall: avg((r) => r.overall), voice: avg((r) => r.breakdown.voice_match ?? 0) }
}

const roster = await sb(`staff?workspace_id=eq.${PEOPLE}&select=id,name`)
const vids = await sb(`media_assets?workspace_id=eq.${PEOPLE}&kind=eq.video&select=id&limit=2000`)
const ownTurns = (msgs, cleaned) => ((cleaned?.length ? cleaned : msgs) || [])
  .filter((m) => m?.role === 'user' && typeof m.content === 'string' && m.content.trim())
  .map((m) => m.content.trim()).join('\n\n')

console.log(`F2 A1 simulation — current (clinical-only top-8) vs balanced (4 clinical + 4 interview)`)
console.log(`voice_match is the dimension F2 targets. mean of ${SAMPLES} samples (${EVAL_MODEL})\n`)

for (const pr of PROBES) {
  const staff = roster.find((r) => r.id.startsWith(pr.staffPfx))
  const fid = vids.find((r) => r.id.startsWith(pr.assetPfx))?.id
  const a = fid ? (await sb(`media_assets?id=eq.${fid}&select=transcription`))[0] : null
  const transcript = String(a?.transcription || '').trim()
  if (!transcript) { console.log(`[skip] ${pr.label} — no transcript`); continue }

  // current reference = clinical (weight>=1.0), top-8 by weight (status quo live scorer)
  const established = await sb(`staff_voice_phrases?staff_id=eq.${staff.id}&select=phrase,weight&order=weight.desc&limit=50`)
  const currentSample = established.slice(0, 8).map((x) => ({ phrase: x.phrase }))

  // simulated backfill: this clinician's interview own-turns → phrases (weight 0.5, in memory)
  const ivs = await sb(`interviews?status=in.(complete,completed)&staff_id=eq.${staff.id}&select=messages,cleaned_messages&limit=100`)
  const interviewPhrases = []
  const seen = new Set(established.map((e) => (e.phrase || '').toLowerCase()))
  for (const iv of ivs) {
    for (const p of extractPhrasesFromContent(ownTurns(iv.messages, iv.cleaned_messages))) {
      if (seen.has(p.phrase.toLowerCase())) continue
      seen.add(p.phrase.toLowerCase())
      interviewPhrases.push({ phrase: p.phrase, weight: 0.5 })
    }
  }
  const balanced = balancedSample(established, interviewPhrases, 8)

  console.log(`━━━ ${pr.label} (${staff.name}) ━━━`)
  console.log(`  reference: current=8 clinical | balanced=${balanced.length} (4 clinical + ${Math.min(4, interviewPhrases.length)} interview, ${interviewPhrases.length} interview avail)`)

  for (const [kind, caption] of [['FAITHFUL-emotional', pr.faithful], ['UNFAITHFUL-clinical', pr.unfaithful]]) {
    const cur = await meanScore({ transcript, caption, phrases: currentSample, staffName: staff.name })
    const bal = await meanScore({ transcript, caption, phrases: balanced, staffName: staff.name })
    const dV = (bal.voice - cur.voice).toFixed(2)
    const dO = (bal.overall - cur.overall).toFixed(2)
    console.log(`  ${kind.padEnd(20)} voice_match ${cur.voice}→${bal.voice} (Δ${dV})   overall ${cur.overall}→${bal.overall} (Δ${dO})`)
  }
  console.log('')
}

console.log('PASS if: balanced LIFTS voice_match on FAITHFUL-emotional, and does NOT lift it on UNFAITHFUL-clinical.')
