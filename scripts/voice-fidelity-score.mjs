#!/usr/bin/env node
/**
 * NarrateRx Voice Fidelity Dashboard
 *
 * Scores every published content_item against the owning clinician's
 * voice phrase corpus using an LLM evaluator. Outputs a trend report
 * by clinician / content type / month.
 *
 * Usage:
 *   node scripts/voice-fidelity-score.mjs [--workspace=<slug>] [--limit=<n>] [--since=<date>]
 *
 * Options:
 *   --workspace=<slug>   Scope to one workspace (default: all)
 *   --limit=<n>          Max items to score (default: 200)
 *   --since=<YYYY-MM-DD> Only score items created after this date
 *
 * Required env (from .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY
 *
 * Output:
 *   .claude/voice-fidelity-dashboard-<date>.md
 *   .claude/voice-fidelity-raw-<date>.json  (machine-readable, for re-analysis)
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
const WORKSPACE_SLUG = args.find(a => a.startsWith('--workspace='))?.split('=')[1] ?? null
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '200', 10)
const SINCE = args.find(a => a.startsWith('--since='))?.split('=')[1] ?? null

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'AI_GATEWAY_API_KEY']) {
  if (!process.env[k] || process.env[k].includes('REDACTED')) {
    console.error(`✗ Missing or redacted env: ${k}`)
    process.exit(1)
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const EVAL_MODEL = 'anthropic/claude-haiku-4-5'

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

// ── Load data ─────────────────────────────────────────────────────────────────
console.log('\n📦 Loading data from Supabase…')

// Workspaces
const wsFilter = WORKSPACE_SLUG ? `slug=eq.${WORKSPACE_SLUG}&` : ''
const workspaces = await sbGet(`workspaces?${wsFilter}select=id,slug,display_name`)
if (!workspaces.length) { console.error('No workspaces found'); process.exit(1) }
console.log(`  ✓ Workspaces: ${workspaces.map(w => w.slug).join(', ')}`)

const workspaceMap = Object.fromEntries(workspaces.map(w => [w.id, w]))
const wsIds = workspaces.map(w => w.id)

// Clinicians (all in scope workspaces)
const clinicians = await sbGet(
  `clinicians?workspace_id=in.(${wsIds.join(',')})&select=id,name,workspace_id,voice_notes`
)
const clinicianMap = Object.fromEntries(clinicians.map(c => [c.id, c]))
console.log(`  ✓ Clinicians: ${clinicians.length}`)

// Voice phrases per clinician
const cIds = clinicians.map(c => c.id)
const phraseRows = cIds.length
  ? await sbGet(`clinician_voice_phrases?clinician_id=in.(${cIds.join(',')})&select=clinician_id,phrase,weight&order=weight.desc`)
  : []
const phrasesMap = {}
for (const p of phraseRows) {
  if (!phrasesMap[p.clinician_id]) phrasesMap[p.clinician_id] = []
  phrasesMap[p.clinician_id].push(p)
}
console.log(`  ✓ Voice phrases: ${phraseRows.length} total across ${Object.keys(phrasesMap).length} clinicians`)

// Content items (approved or published, with content text).
// Fetch per-workspace to avoid URL-length issues with in.() on many UUIDs.
const allContentItems = []
const perWsLimit = Math.ceil(LIMIT / wsIds.length)
for (const wsId of wsIds) {
  // Note: avoid `content=not.is.null` — PostgREST treats `content` as reserved; filter client-side.
  let ciPath = `content_items?workspace_id=eq.${wsId}&status=in.(approved,published)&select=id,workspace_id,clinician_id,platform,content,created_at&order=created_at.desc&limit=${perWsLimit}`
  if (SINCE) ciPath += `&created_at=gte.${SINCE}`
  const items = await sbGet(ciPath)
  allContentItems.push(...items)
}
const contentItems = allContentItems.slice(0, LIMIT)
console.log(`  ✓ Content items to score: ${contentItems.length}`)

// ── Evaluator ─────────────────────────────────────────────────────────────────
function buildEvalPrompt({ body, clinicianName, phrases, kind, workspaceName }) {
  const phraseExamples = (phrases || []).slice(0, 8).map(p => `- "${p.phrase}"`).join('\n')
  const hasPhrases = phraseExamples.length > 0

  return {
    system: `You are a precise content quality evaluator. Score the given piece on multiple voice fidelity dimensions. Return ONLY valid JSON — no markdown, no preamble, no commentary.`,
    user: `Evaluate this ${kind || 'blog post'} written for ${clinicianName} at ${workspaceName}.

${hasPhrases ? `CLINICIAN'S AUTHENTIC VOICE PHRASES (from their approved content — use these to judge fidelity):
${phraseExamples}` : `(No voice phrases on record for this clinician yet.)`}

CONTENT TO EVALUATE (${(body || '').split(/\s+/).length} words):
---
${(body || '').slice(0, 2500)}${(body || '').length > 2500 ? '\n[truncated]' : ''}
---

Score each dimension 1–10 and return this exact JSON:
{
  "voice_fidelity": <1-10; how closely the writing style, rhythm, and word choice matches the voice phrases register${hasPhrases ? ' above' : '; score 5 if no phrases to compare'}>,
  "clinical_texture": <1-10; does it sound like a real clinician sharing genuine knowledge, vs generic content-mill copy>,
  "redundancy": <1-10 INVERSE — 10=no redundancy/repetition, 1=same ideas repeated>,
  "specificity": <1-10; does it contain concrete details (patient stories, timelines, mechanisms) vs vague generalities>,
  "brand_fit": <1-10; does it feel like authentic content from a real practice, not a corporate template>,
  "word_count": <integer>,
  "red_flag": "<one phrase: the single biggest quality issue, or 'none' if strong>"
}`
  }
}

// ── Main scoring loop ─────────────────────────────────────────────────────────
console.log(`\n🔬 Scoring ${contentItems.length} content items with ${EVAL_MODEL}…\n`)

const scored = []
let skipped = 0

for (let i = 0; i < contentItems.length; i++) {
  const item = contentItems[i]
  const clinician = clinicianMap[item.clinician_id]
  const workspace = workspaceMap[item.workspace_id]
  const phrases = phrasesMap[item.clinician_id] || []

  if (!item.content || item.content.trim().length < 100) {
    skipped++
    continue
  }

  const cName = clinician?.name || 'unknown clinician'
  const wName = workspace?.display_name || 'unknown workspace'

  process.stdout.write(`  [${i+1}/${contentItems.length}] ${item.platform?.padEnd(12)} ${cName.slice(0,15).padEnd(15)} `)

  try {
    const evalPrompt = buildEvalPrompt({
      body: item.content,
      clinicianName: cName,
      phrases,
      kind: item.platform,  // `platform` is the column name in content_items
      workspaceName: wName,
    })

    const { text } = await generateText({
      model: EVAL_MODEL,
      system: evalPrompt.system,
      messages: [{ role: 'user', content: evalPrompt.user }],
      maxOutputTokens: 250,
    })

    let evalResult = {}
    try {
      evalResult = JSON.parse(text.trim())
    } catch {
      // Strip markdown fences if present
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      try { evalResult = JSON.parse(cleaned) } catch { /* ignore */ }
    }

    const dims = ['voice_fidelity', 'clinical_texture', 'redundancy', 'specificity', 'brand_fit']
    const validDims = dims.filter(d => evalResult[d] != null)
    const overall = validDims.length
      ? (validDims.reduce((s, d) => s + evalResult[d], 0) / validDims.length).toFixed(1)
      : null

    const month = item.created_at?.slice(0, 7) || 'unknown'

    scored.push({
      id: item.id,
      kind: item.platform,  // `platform` is the column name in content_items
      clinicianId: item.clinician_id,
      clinicianName: cName,
      workspaceId: item.workspace_id,
      workspaceName: wName,
      month,
      createdAt: item.created_at,
      hasPhrases: phrases.length > 0,
      phraseCount: phrases.length,
      wordCount: evalResult.word_count || (item.content || '').split(/\s+/).filter(Boolean).length,
      scores: evalResult,
      overall: overall ? parseFloat(overall) : null,
      redFlag: evalResult.red_flag || null,
    })

    console.log(`${overall ? `${overall}/10` : '  ?'}  ${evalResult.red_flag || ''}`)
  } catch (err) {
    console.error(`ERROR: ${err.message}`)
    skipped++
  }
}

console.log(`\n  Done. Scored: ${scored.length}, skipped: ${skipped}`)

// ── Analysis helpers ──────────────────────────────────────────────────────────
function avg(arr, fn) {
  const vals = arr.map(fn).filter(v => v != null && !isNaN(v))
  return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 'n/a'
}

function groupBy(arr, fn) {
  const out = {}
  for (const item of arr) {
    const k = fn(item)
    if (!out[k]) out[k] = []
    out[k].push(item)
  }
  return out
}

// ── Build dashboard report ────────────────────────────────────────────────────
console.log('\n📊 Building dashboard report…')

const dateStr = new Date().toISOString().slice(0, 10)

// Overall stats
const allOverall = scored.filter(s => s.overall != null).map(s => s.overall)
const globalAvg = allOverall.length
  ? (allOverall.reduce((a, b) => a + b, 0) / allOverall.length).toFixed(2)
  : 'n/a'

// By clinician
const byClinician = groupBy(scored, s => s.clinicianName)
const clinicianRows = Object.entries(byClinician)
  .map(([name, items]) => ({
    name,
    count: items.length,
    overall: avg(items, i => i.overall),
    vf: avg(items, i => i.scores.voice_fidelity),
    ct: avg(items, i => i.scores.clinical_texture),
    sp: avg(items, i => i.scores.specificity),
    hasPhrases: items[0]?.hasPhrases,
    phraseCount: items[0]?.phraseCount ?? 0,
  }))
  .sort((a, b) => parseFloat(b.overall) - parseFloat(a.overall))

// By content kind
const byKind = groupBy(scored, s => s.kind || 'unknown')
const kindRows = Object.entries(byKind)
  .map(([kind, items]) => ({
    kind,
    count: items.length,
    overall: avg(items, i => i.overall),
    vf: avg(items, i => i.scores.voice_fidelity),
    sp: avg(items, i => i.scores.specificity),
    avgWords: avg(items, i => i.wordCount),
  }))
  .sort((a, b) => parseFloat(b.overall) - parseFloat(a.overall))

// By month
const byMonth = groupBy(scored, s => s.month)
const monthRows = Object.entries(byMonth)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([month, items]) => ({
    month,
    count: items.length,
    overall: avg(items, i => i.overall),
    vf: avg(items, i => i.scores.voice_fidelity),
  }))

// Top red flags
const redFlagCounts = {}
for (const s of scored) {
  if (s.redFlag && s.redFlag !== 'none') {
    redFlagCounts[s.redFlag] = (redFlagCounts[s.redFlag] || 0) + 1
  }
}
const topFlags = Object.entries(redFlagCounts)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 10)

// Bottom 10 pieces (need most attention)
const bottom10 = [...scored]
  .filter(s => s.overall != null)
  .sort((a, b) => a.overall - b.overall)
  .slice(0, 10)

// Top 10 pieces (best examples to study)
const top10 = [...scored]
  .filter(s => s.overall != null)
  .sort((a, b) => b.overall - a.overall)
  .slice(0, 10)

let report = `# NarrateRx Voice Fidelity Dashboard — ${dateStr}

> Generated by \`scripts/voice-fidelity-score.mjs\`
> Scope: ${WORKSPACE_SLUG || 'all workspaces'} | Items scored: ${scored.length} | Eval model: ${EVAL_MODEL}
> Date range: ${SINCE || 'all time'} to ${dateStr}

## Global Health

| Metric | Value |
|---|---|
| Items scored | ${scored.length} |
| Global avg overall score | **${globalAvg} / 10** |
| Avg voice fidelity | ${avg(scored, s => s.scores.voice_fidelity)} |
| Avg clinical texture | ${avg(scored, s => s.scores.clinical_texture)} |
| Avg specificity | ${avg(scored, s => s.scores.specificity)} |
| Avg redundancy (10=none) | ${avg(scored, s => s.scores.redundancy)} |
| Items with voice phrases | ${scored.filter(s => s.hasPhrases).length} of ${scored.length} |
| Items without voice phrases | ${scored.filter(s => !s.hasPhrases).length} of ${scored.length} |

${scored.filter(s => s.hasPhrases).length > 0 && scored.filter(s => !s.hasPhrases).length > 0 ? `### Phrases impact
| Group | Count | Avg Overall | Avg Voice Fidelity |
|---|---|---|---|
| With voice phrases | ${scored.filter(s => s.hasPhrases).length} | ${avg(scored.filter(s => s.hasPhrases), s => s.overall)} | ${avg(scored.filter(s => s.hasPhrases), s => s.scores.voice_fidelity)} |
| Without voice phrases | ${scored.filter(s => !s.hasPhrases).length} | ${avg(scored.filter(s => !s.hasPhrases), s => s.overall)} | ${avg(scored.filter(s => !s.hasPhrases), s => s.scores.voice_fidelity)} |
` : ''}
---

## By Clinician

| Clinician | Items | Overall | Voice Fidelity | Clinical Texture | Specificity | Phrases |
|---|---|---|---|---|---|---|
${clinicianRows.map(r => `| ${r.name} | ${r.count} | **${r.overall}** | ${r.vf} | ${r.ct} | ${r.sp} | ${r.hasPhrases ? `✓ (${r.phraseCount})` : '✗ none'} |`).join('\n')}

---

## By Content Type

| Type | Count | Overall | Voice Fidelity | Specificity | Avg Words |
|---|---|---|---|---|---|
${kindRows.map(r => `| ${r.kind} | ${r.count} | **${r.overall}** | ${r.vf} | ${r.sp} | ${r.avgWords} |`).join('\n')}

---

## Trend Over Time

| Month | Items | Overall | Voice Fidelity |
|---|---|---|---|
${monthRows.map(r => `| ${r.month} | ${r.count} | ${r.overall} | ${r.vf} |`).join('\n')}

${monthRows.length >= 3 ? `**Trend:** ${
  parseFloat(monthRows[monthRows.length-1].overall) > parseFloat(monthRows[0].overall)
    ? '📈 Improving — overall score trending up over time'
    : parseFloat(monthRows[monthRows.length-1].overall) < parseFloat(monthRows[0].overall)
    ? '📉 Declining — overall score trending down; investigate recent changes'
    : '→ Stable — no meaningful trend in either direction'
}` : ''}

---

## Top Quality Issues (Red Flags)

${topFlags.length ? topFlags.map(([flag, count]) => `- **${flag}** — flagged in ${count} piece${count > 1 ? 's' : ''}`).join('\n') : '_No significant quality issues detected_'}

---

## Lowest-Scoring Pieces (Most Attention Needed)

| # | Clinician | Type | Month | Score | Red Flag |
|---|---|---|---|---|---|
${bottom10.map((s, i) => `| ${i+1} | ${s.clinicianName} | ${s.kind} | ${s.month} | ${s.overall} | ${s.redFlag || '-'} |`).join('\n')}

---

## Highest-Scoring Pieces (Best Examples to Study)

| # | Clinician | Type | Month | Score | Notes |
|---|---|---|---|---|---|
${top10.map((s, i) => `| ${i+1} | ${s.clinicianName} | ${s.kind} | ${s.month} | ${s.overall} | ${s.redFlag === 'none' ? '✓ clean' : (s.redFlag || '-')} |`).join('\n')}

---

## Recommendations

${clinicianRows.length ? `**Per clinician:**
${clinicianRows.map(r => {
  const score = parseFloat(r.overall)
  if (isNaN(score)) return ''
  if (score >= 7.5) return `- **${r.name}**: Strong (${r.overall}) — use as voice benchmark for other clinicians`
  if (score >= 6.0) return `- **${r.name}**: Good (${r.overall}) — ${!r.hasPhrases ? 'collect voice phrases to improve fidelity' : 'review low-scoring pieces for prompt tuning'}`
  return `- **${r.name}**: Needs work (${r.overall}) — ${!r.hasPhrases ? 'no voice phrases loaded; start there' : 'phrases loaded but fidelity low — review prompt tone modifier'}`
}).filter(Boolean).join('\n')}` : ''}

**By content type:**
${kindRows.map(r => {
  const score = parseFloat(r.overall)
  if (isNaN(score)) return ''
  return `- **${r.kind}**: ${score >= 7.5 ? '✓ Strong' : score >= 6.0 ? '→ Acceptable' : '⚠️ Needs attention'} (${r.overall}/10)`
}).filter(Boolean).join('\n')}

---

_Re-run to track changes: \`node scripts/voice-fidelity-score.mjs --since=${dateStr}\`_
`

const outputDir = '.claude'
if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true })

const mdPath = `${outputDir}/voice-fidelity-dashboard-${dateStr}.md`
const jsonPath = `${outputDir}/voice-fidelity-raw-${dateStr}.json`

await Promise.all([
  writeFile(mdPath, report, 'utf8'),
  writeFile(jsonPath, JSON.stringify({ meta: { dateStr, workspace: WORKSPACE_SLUG, scored: scored.length }, scored }, null, 2), 'utf8'),
])

console.log(`✅ Dashboard: ${mdPath}`)
console.log(`✅ Raw data:  ${jsonPath}`)
console.log(`   Global avg: ${globalAvg}/10 across ${scored.length} pieces`)
