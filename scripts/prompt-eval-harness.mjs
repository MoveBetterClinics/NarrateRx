#!/usr/bin/env node
/**
 * NarrateRx Prompt Eval Harness
 *
 * Runs targeted A/B and sweep tests on the major generation prompts using
 * real Move Better interview transcripts from Supabase. Scores each output
 * on voice fidelity, clinical texture, redundancy, hook strength, and CTA
 * naturalness via a separate evaluator call.
 *
 * Usage:
 *   node scripts/prompt-eval-harness.mjs [--workspace=<slug>] [--dry-run] [--quick]
 *
 * Options:
 *   --workspace=<slug>  Override target workspace (default: movebetter-people)
 *   --dry-run           Print variant configs only; skip API calls
 *   --quick             Run only the tone sweep (fastest sanity check)
 *
 * Required env (from .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY
 *
 * Output:
 *   .claude/prompt-eval-results-<date>.md
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { generateText } from 'ai'

// ── env ──────────────────────────────────────────────────────────────────────
const envText = await readFile('.env.local', 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
const args = process.argv.slice(2)
const WORKSPACE_SLUG = args.find(a => a.startsWith('--workspace='))?.split('=')[1] ?? 'movebetter-people'
const DRY_RUN = args.includes('--dry-run')
const QUICK = args.includes('--quick')

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'AI_GATEWAY_API_KEY']) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`✗ Missing or redacted env: ${k}`)
    process.exit(1)
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MODEL = 'anthropic/claude-sonnet-4-6'
const EVAL_MODEL = 'anthropic/claude-haiku-4-5'  // cheaper for scoring

// ── Supabase helpers ──────────────────────────────────────────────────────────
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function sbGet(path) {
  const r = await sb(path)
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${path}`)
  return r.json()
}

// ── Load test fixtures from DB ────────────────────────────────────────────────
console.log(`\n📦 Loading test fixtures from Supabase (workspace: ${WORKSPACE_SLUG})…`)

const [wsArr] = await Promise.all([
  sbGet(`workspaces?slug=eq.${WORKSPACE_SLUG}&select=*&limit=1`)
])
if (!wsArr.length) { console.error('Workspace not found'); process.exit(1) }
const workspace = wsArr[0]
console.log(`  ✓ Workspace: ${workspace.display_name} (${workspace.id})`)

// Pull up to 5 completed interviews with messages
const interviews = await sbGet(
  `interviews?workspace_id=eq.${workspace.id}&status=eq.completed&messages=not.is.null&select=id,topic,messages,clinician_id,created_at&order=created_at.desc&limit=5`
)
console.log(`  ✓ Interviews: ${interviews.length}`)
if (!interviews.length) { console.error('No completed interviews found'); process.exit(1) }

// Pull clinicians for voice data
const clinicianIds = [...new Set(interviews.map(i => i.clinician_id).filter(Boolean))]
const clinicians = clinicianIds.length
  ? await sbGet(`clinicians?id=in.(${clinicianIds.join(',')})&select=id,name,voice_notes`)
  : []
const clinicianMap = Object.fromEntries(clinicians.map(c => [c.id, c]))

// Pull voice phrases for each clinician
const phraseRows = clinicianIds.length
  ? await sbGet(`clinician_voice_phrases?clinician_id=in.(${clinicianIds.join(',')})&select=clinician_id,phrase,weight&order=weight.desc&limit=50`)
  : []
const phrasesMap = {}
for (const p of phraseRows) {
  if (!phrasesMap[p.clinician_id]) phrasesMap[p.clinician_id] = []
  phrasesMap[p.clinician_id].push(p)
}

console.log(`  ✓ Clinicians: ${clinicians.map(c => c.name).join(', ')}`)
console.log(`  ✓ Voice phrases: ${phraseRows.length} total`)

// ── Build transcript helper ───────────────────────────────────────────────────
function buildTranscript(interview) {
  const msgs = Array.isArray(interview.messages) ? interview.messages : []
  return msgs
    .filter(m => m.role === 'user')
    .map((m, i) => `[Turn ${i + 1}] ${m.content}`)
    .join('\n\n')
}

// Pick 3 interviews for testing (spread across topics if possible)
const testInterviews = interviews.slice(0, 3)

// ── Import prompt builders ────────────────────────────────────────────────────
// Import from src/ — these are plain ESM with no browser APIs
const {
  getBlogPostSystemPrompt,
  getMinimalEditSystemPrompt,
  voicePhrasesBlock,
  voiceNotesBlock,
} = await import('../src/lib/prompts.js')

// ── Variant definitions ───────────────────────────────────────────────────────
// Each variant specifies parameters passed to getBlogPostSystemPrompt.
// The "group" field clusters related variants for comparison.

function makeVariants(interview, clinician, phrases, voiceNotes) {
  const cName = clinician?.name || 'the clinician'
  const condition = interview.topic || 'low back pain'
  const transcript = buildTranscript(interview)
  const phrasesArr = phrases || []

  // Baseline config
  const BASE = {
    workspace, clinicianName: cName, condition,
    tone: 'smart', voiceMode: 'practice', prototypeId: null,
    voiceNotes: voiceNotes || '', voicePhrases: phrasesArr,
    audienceSlot: null, storyTypeSlot: null, lengthPreset: null, ownHistoryBlock: ''
  }

  return [
    // ── Group 1: Tone sweep ────────────────────────────────────────────────
    { id: 'tone-smart',    group: 'tone', label: 'Tone: Smart Default',    ...BASE, tone: 'smart' },
    { id: 'tone-active',   group: 'tone', label: 'Tone: Active & Driven',  ...BASE, tone: 'active' },
    { id: 'tone-clinical', group: 'tone', label: 'Tone: Clinical & Depth', ...BASE, tone: 'clinical' },
    { id: 'tone-warm',     group: 'tone', label: 'Tone: Warm & Reassuring',...BASE, tone: 'warm' },

    // ── Group 2: Voice phrases A/B ─────────────────────────────────────────
    { id: 'phrases-on',  group: 'phrases', label: 'Voice phrases: ON',  ...BASE, voicePhrases: phrasesArr },
    { id: 'phrases-off', group: 'phrases', label: 'Voice phrases: OFF', ...BASE, voicePhrases: [] },

    // ── Group 3: Length preset sweep ───────────────────────────────────────
    { id: 'length-tight',     group: 'length', label: 'Length: Tight',     ...BASE, lengthPreset: 'tight' },
    { id: 'length-standard',  group: 'length', label: 'Length: Standard',  ...BASE, lengthPreset: null },
    { id: 'length-expansive', group: 'length', label: 'Length: Expansive', ...BASE, lengthPreset: 'expansive' },

    // ── Group 4: Voice mode A/B ────────────────────────────────────────────
    { id: 'voice-practice', group: 'voiceMode', label: 'Voice: Practice (clinic)', ...BASE, voiceMode: 'practice' },
    { id: 'voice-personal', group: 'voiceMode', label: 'Voice: Personal (I/me)',   ...BASE, voiceMode: 'personal' },

    // ── Group 5: Voice notes A/B ───────────────────────────────────────────
    { id: 'notes-on',  group: 'notes', label: 'Voice notes: ON',  ...BASE, voiceNotes: voiceNotes || '' },
    { id: 'notes-off', group: 'notes', label: 'Voice notes: OFF', ...BASE, voiceNotes: '' },
  ]
}

// ── Scoring prompt ────────────────────────────────────────────────────────────
function buildEvalPrompt({ blogPost, clinicianName, condition, voicePhrases, workspace }) {
  const phraseExamples = (voicePhrases || []).slice(0, 6).map(p => `- "${p.phrase}"`).join('\n')
  return {
    system: `You are a precise content quality evaluator for a clinical content platform. You score blog posts on specific dimensions. Your entire response must be a single valid JSON object. Do NOT wrap it in markdown code fences. Do NOT include any text before or after the JSON object. Start your response with { and end with }.`,
    user: `Evaluate this blog post about "${condition}" written for a clinician named ${clinicianName} at ${workspace.display_name}.

CLINICIAN'S KNOWN VOICE PHRASES (authentic lines from their approved content):
${phraseExamples || '(none available)'}

BLOG POST TO EVALUATE:
---
${blogPost.slice(0, 3000)}${blogPost.length > 3000 ? '\n[truncated for eval]' : ''}
---

Score each dimension 1–10. Return this exact JSON shape:
{
  "voice_fidelity": <1-10, how closely writing style matches voice phrase register — rhythm, word choice, sentence length>,
  "clinical_texture": <1-10, does it sound like a real clinician or generic content-mill copy>,
  "redundancy": <1-10 INVERSE — 10=zero redundancy, 1=highly repetitive>,
  "hook_strength": <1-10, is the opening paragraph compelling and specific>,
  "cta_naturalness": <1-10, does the call-to-action feel earned and human vs. salesy>,
  "word_count": <integer word count of the post>,
  "notes": "<one sentence observation about the biggest quality difference vs generic clinical content>"
}`
  }
}

// ── Main eval loop ────────────────────────────────────────────────────────────
console.log(`\n🧪 Running prompt eval harness…`)
console.log(`   Workspace: ${workspace.display_name}`)
console.log(`   Transcripts: ${testInterviews.length}`)
console.log(`   Model: ${MODEL}`)
console.log(`   Eval model: ${EVAL_MODEL}`)
if (DRY_RUN) console.log(`   ⚠️  DRY RUN — skipping API calls`)
if (QUICK)   console.log(`   ⚡ QUICK mode — tone sweep only`)
console.log()

const results = []  // { variantId, group, label, topic, score, wordCount, blogSnippet, notes }

for (const interview of testInterviews) {
  const clinician = clinicianMap[interview.clinician_id]
  const phrases = phrasesMap[interview.clinician_id] || []
  const voiceNotes = clinician?.voice_notes || ''
  const variants = makeVariants(interview, clinician, phrases, voiceNotes)
  const activeVariants = QUICK ? variants.filter(v => v.group === 'tone') : variants
  const transcript = buildTranscript(interview)

  if (!transcript.trim()) {
    console.log(`  ⚠️  Interview ${interview.id} has no user messages — skipping`)
    continue
  }

  console.log(`\n📝 Interview: "${interview.topic}" (${interview.id.slice(0, 8)})`)
  console.log(`   Clinician: ${clinician?.name || 'unknown'} | Phrases: ${phrases.length}`)
  console.log(`   Transcript: ${transcript.split(' ').length} words`)
  console.log(`   Variants: ${activeVariants.length}`)

  for (const variant of activeVariants) {
    const promptText = getBlogPostSystemPrompt(
      variant.workspace,
      variant.clinicianName,
      variant.condition,
      variant.tone,
      variant.voiceMode,
      variant.prototypeId,
      variant.voiceNotes,
      variant.voicePhrases,
      variant.audienceSlot,
      variant.storyTypeSlot,
      variant.lengthPreset,
      variant.ownHistoryBlock,
    )

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${variant.label} — prompt ${promptText.length} chars`)
      results.push({ variantId: variant.id, group: variant.group, label: variant.label,
        topic: interview.topic, score: null, wordCount: null, blogSnippet: '[dry run]', notes: '' })
      continue
    }

    process.stdout.write(`  ${variant.label}… `)
    const t0 = Date.now()

    let blogPost = ''
    let evalResult = {}

    try {
      // Generate blog post
      const { text } = await generateText({
        model: MODEL,
        system: promptText,
        messages: [{ role: 'user', content: `INTERVIEW TRANSCRIPT:\n\n${transcript}` }],
        maxOutputTokens: 2000,
      })
      blogPost = text || ''

      // Strip provenance block before scoring (it's not part of the readable output)
      const cleanPost = blogPost.replace(/<PROVENANCE>[\s\S]*?<\/PROVENANCE>/g, '').trim()
      const wordCount = cleanPost.split(/\s+/).filter(Boolean).length

      // Evaluate the output
      const evalPrompt = buildEvalPrompt({
        blogPost: cleanPost,
        clinicianName: variant.clinicianName,
        condition: variant.condition,
        voicePhrases: variant.voicePhrases,
        workspace: variant.workspace,
      })

      const { text: evalText } = await generateText({
        model: EVAL_MODEL,
        system: evalPrompt.system,
        messages: [{ role: 'user', content: evalPrompt.user }],
        maxOutputTokens: 600,  // 300 caused truncation; haiku wraps in ```json fences even with "no markdown" instruction
      })

      try {
        evalResult = JSON.parse(evalText.trim())
      } catch {
        // Strip markdown fences (haiku often ignores the "no fences" instruction)
        const cleaned = evalText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        try {
          evalResult = JSON.parse(cleaned)
        } catch {
          // Fall back to regex extraction — handles truncated JSON where the
          // closing brace never arrived before the token cap hit.
          const scores = {}
          const numRe = /"(voice_fidelity|clinical_texture|redundancy|hook_strength|cta_naturalness|word_count)"\s*:\s*(\d+)/g
          let m
          while ((m = numRe.exec(cleaned || evalText)) !== null) scores[m[1]] = parseInt(m[2], 10)
          const noteM = (cleaned || evalText).match(/"notes"\s*:\s*"([^"]*)"/)
          if (noteM) scores.notes = noteM[1]
          evalResult = Object.keys(scores).length ? scores : {}
          if (Object.keys(evalResult).length) {
            process.stdout.write(`[partial] `)
          } else {
            console.warn('\n    ⚠️  Eval parse completely failed:', evalText.slice(0, 80))
          }
        }
      }

      // Overall = avg of whichever scored dims are present (partial is OK)
      const scoreDims = ['voice_fidelity', 'clinical_texture', 'redundancy', 'hook_strength', 'cta_naturalness']
      const presentDims = scoreDims.filter(d => evalResult[d] != null)
      const overallScore = presentDims.length >= 3
        ? (presentDims.reduce((s, d) => s + evalResult[d], 0) / presentDims.length).toFixed(1)
        : null

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`${overallScore ? `score ${overallScore}/10` : '?'} | ${wordCount}w | ${elapsed}s`)

      results.push({
        variantId: variant.id,
        group: variant.group,
        label: variant.label,
        topic: interview.topic,
        wordCount,
        scores: evalResult,
        overallScore: overallScore ? parseFloat(overallScore) : null,
        blogSnippet: cleanPost.slice(0, 400),
        notes: evalResult.notes || '',
      })
    } catch (err) {
      console.error(`\n    ✗ Error: ${err.message}`)
      results.push({
        variantId: variant.id, group: variant.group, label: variant.label,
        topic: interview.topic, wordCount: null, scores: {}, overallScore: null,
        blogSnippet: `[error: ${err.message}]`, notes: '',
      })
    }
  }
}

// ── Build report ──────────────────────────────────────────────────────────────
console.log(`\n📊 Building report…`)

function groupResults(results) {
  const byGroup = {}
  for (const r of results) {
    if (!byGroup[r.group]) byGroup[r.group] = []
    byGroup[r.group].push(r)
  }
  return byGroup
}

function renderGroupTable(items) {
  // Average scores across transcripts for each variantId
  const byVariant = {}
  for (const r of items) {
    if (!byVariant[r.variantId]) byVariant[r.variantId] = { label: r.label, runs: [] }
    byVariant[r.variantId].runs.push(r)
  }

  const rows = Object.values(byVariant).map(v => {
    const valid = v.runs.filter(r => r.overallScore != null)
    const avg = valid.length
      ? (valid.reduce((s, r) => s + r.overallScore, 0) / valid.length).toFixed(1)
      : 'n/a'
    const wc = valid.length
      ? Math.round(valid.reduce((s, r) => s + (r.wordCount || 0), 0) / valid.length)
      : 'n/a'
    const vf = valid.length
      ? (valid.reduce((s, r) => s + (r.scores.voice_fidelity || 0), 0) / valid.length).toFixed(1)
      : 'n/a'
    const ct = valid.length
      ? (valid.reduce((s, r) => s + (r.scores.clinical_texture || 0), 0) / valid.length).toFixed(1)
      : 'n/a'
    return { label: v.label, avg, wc, vf, ct, notes: valid[0]?.notes || '' }
  }).sort((a, b) => (parseFloat(b.avg) || 0) - (parseFloat(a.avg) || 0))

  const lines = [
    '| Variant | Overall | Voice Fidelity | Clinical Texture | Avg Words | Notes |',
    '|---|---|---|---|---|---|',
  ]
  for (const r of rows) {
    const medal = r === rows[0] && rows.length > 1 ? ' 🏆' : ''
    lines.push(`| ${r.label}${medal} | **${r.avg}** | ${r.vf} | ${r.ct} | ${r.wc} | ${r.notes} |`)
  }
  return lines.join('\n')
}

const byGroup = groupResults(results)

const groupLabels = {
  tone:      '## Test 1 — Tone Sweep\n_Which tone setting produces the most voice-faithful, clinically textured output?_',
  phrases:   '## Test 2 — Voice Phrases A/B\n_Does injecting the clinician\'s voice phrase anchors measurably improve fidelity?_',
  length:    '## Test 3 — Length Preset Sweep\n_Which length preset produces the most readable output?_',
  voiceMode: '## Test 4 — Practice vs Personal Voice\n_Does personal voice (I/me) produce more authentic-feeling output?_',
  notes:     '## Test 5 — Voice Notes A/B\n_Do learned voice notes from edit patterns add measurable signal over phrases alone?_',
}

const allScored = results.filter(r => r.overallScore != null)
const globalBest = allScored.sort((a, b) => b.overallScore - a.overallScore).slice(0, 3)

const dateStr = new Date().toISOString().slice(0, 10)
let report = `# NarrateRx Prompt Eval Results — ${dateStr}

> Generated by \`scripts/prompt-eval-harness.mjs\` against workspace **${workspace.display_name}**
> Transcripts used: ${testInterviews.length} | Total variants run: ${results.length} | DRY RUN: ${DRY_RUN}
> Models: generation=${MODEL} | evaluation=${EVAL_MODEL}

## Executive Summary

${globalBest.length ? `**Top 3 configurations overall:**
${globalBest.map((r, i) => `${i+1}. **${r.label}** on "${r.topic}" — overall ${r.overallScore}/10`).join('\n')}` : '_No scored results (dry run or all errors)_'}

---

`

for (const [group, items] of Object.entries(byGroup)) {
  const header = groupLabels[group] || `## ${group}`
  report += `${header}\n\n${renderGroupTable(items)}\n\n`

  // Winner call-out
  const ranked = [...items].filter(r => r.overallScore != null)
    .sort((a, b) => b.overallScore - a.overallScore)
  if (ranked.length >= 2) {
    const winner = ranked[0]
    const delta = (winner.overallScore - ranked[ranked.length - 1].overallScore).toFixed(1)
    report += `**Winner:** ${winner.label} (+${delta} over bottom of group across ${testInterviews.length} transcripts)\n\n`
  }

  report += `---\n\n`
}

// Recommendations section
report += `## Recommendations\n\n`
report += `_Based on eval results — apply these to prompt defaults in \`src/lib/prompts.js\`:_\n\n`
for (const [group, items] of Object.entries(byGroup)) {
  const ranked = [...items].filter(r => r.overallScore != null)
    .sort((a, b) => b.overallScore - a.overallScore)
  if (ranked.length) {
    const winner = ranked[0]
    report += `- **${group}:** Set default to \`${winner.variantId}\` (${winner.label}, avg ${winner.overallScore}/10)\n`
  }
}

report += `\n---\n\n## Raw Results (all variants)\n\n`
report += '| Topic | Group | Variant | Overall | VoiceFidelity | ClinicalTexture | Redundancy | Hook | CTA | Words |\n'
report += '|---|---|---|---|---|---|---|---|---|---|\n'
for (const r of results) {
  const s = r.scores || {}
  report += `| ${r.topic?.slice(0, 30) || '?'} | ${r.group} | ${r.label} | ${r.overallScore ?? 'n/a'} | ${s.voice_fidelity ?? '-'} | ${s.clinical_texture ?? '-'} | ${s.redundancy ?? '-'} | ${s.hook_strength ?? '-'} | ${s.cta_naturalness ?? '-'} | ${r.wordCount ?? '-'} |\n`
}

// Save report
const outputDir = '.claude'
if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true })
const outputPath = `${outputDir}/prompt-eval-results-${dateStr}.md`
await writeFile(outputPath, report, 'utf8')

console.log(`\n✅ Report written to ${outputPath}`)
console.log(`   Total variants: ${results.length}`)
console.log(`   Scored: ${allScored.length}`)
if (globalBest.length) {
  console.log(`   Best overall: ${globalBest[0].label} (${globalBest[0].overallScore}/10)`)
}
